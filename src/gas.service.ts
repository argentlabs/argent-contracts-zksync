import { exec } from "child_process";
import { BigNumber } from "ethers";
import fs from "fs";
import hre, { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount } from "../typechain-types";
import { connect, deployProxyAccount } from "./account.service";
import { checkDeployer, getDeployer, loadArtifacts } from "./deployer.service";
import { deployFactory, deployImplementation } from "./infrastructure.service";
import { ArgentInfrastructure, TransactionResponse } from "./model";
import { changeOwnerWithSignature } from "./recovery.service";

export const runGasReport = async (mode: "write" | "check") => {
  if (hre.network.name !== "local") {
    console.error("L2 gas comparisons are only consistent with constant L1 gas price");
    return process.exit(1);
  }

  const report = await measureGasCosts();
  const formatted = formatReport(report);
  console.log(formatted);

  if (mode === "write") {
    fs.writeFileSync("./gas-report.txt", formatted);
  } else if (mode === "check") {
    fs.writeFileSync("./gas-report-new.txt", formatted);
    exec("diff gas-report.txt gas-report-new.txt", (err, stdout, stderr) => {
      if (stdout) {
        console.log(stdout);
        console.error("Changes to gas costs detected. Please review them and update the gas report if appropriate.\n");
        return process.exit(1);
      } else {
        console.log("✨  No changes to basic gas costs.");
      }
    });
  }
};

const measureGasCosts = async () => {
  const { deployer } = getDeployer();
  await checkDeployer(deployer);
  const artifacts = await loadArtifacts(deployer);

  const argentPartial = { deployer, artifacts } as Partial<ArgentInfrastructure>;
  const report: Record<string, BigNumber> = {};

  let response, account: ArgentAccount, owner, guardian, ownerAddress: string, guardianAddress: string;

  console.log("Infrastructure deployment");

  report["Deploy implementation"] = await measure(async () => {
    const [implementation] = await deployImplementation(deployer);
    argentPartial.implementation = implementation;
    return implementation.deployTransaction;
  });

  report["Deploy factory"] = await measure(async () => {
    const [factory] = await deployFactory(deployer);
    argentPartial.factory = factory;
    return factory.deployTransaction;
  });

  const argent = argentPartial as ArgentInfrastructure;

  console.log("Account deployment");

  ({ ownerAddress, guardianAddress } = randomSigners());
  report["Deploy account"] = await measure(async () => {
    [response] = await deployProxyAccount({ argent, ownerAddress, guardianAddress });
    return response;
  });

  const newAccountFinalized = async () => {
    const { owner, guardian, ownerAddress, guardianAddress } = randomSigners();
    let [, account] = await deployProxyAccount({ argent, ownerAddress, guardianAddress });
    account = connect(account, [owner, guardian]);
    const response = await deployer.zkWallet.sendTransaction({
      to: account.address,
      value: ethers.utils.parseEther("1"),
    });
    await response.waitFinalize();
    return account;
  };

  console.log("Transactions");

  const eoa = zksync.Wallet.createRandom().connect(deployer.zkWallet.provider);
  await deployer.zkWallet.sendTransaction({ to: eoa.address, value: ethers.utils.parseEther("1") });
  account = await newAccountFinalized();

  let to = randomAddress();
  report["Transfer ETH from EOA to new EOA"] = await measure(() => eoa.sendTransaction({ to, value: 1 }));
  report["Transfer ETH from EOA to existing EOA"] = await measure(() => eoa.sendTransaction({ to, value: 1 }));

  to = randomAddress();
  report["Transfer ETH from Argent to new EOA"] = await measure(() => account.signer.sendTransaction({ to, value: 1 }));
  report["Transfer ETH from Argent to existing EOA"] = await measure(() =>
    account.signer.sendTransaction({ to, value: 1 }),
  );

  report["Multicall with 2 transfers"] = await measure(() =>
    account.multicall([
      { to: randomAddress(), value: 1, data: "0x" },
      { to: randomAddress(), value: 1, data: "0x" },
    ]),
  );

  console.log("Recovery");

  report["Change owner"] = await measure(() => changeOwnerWithSignature(zksync.Wallet.createRandom(), account));

  account = await newAccountFinalized();
  report["Change guardian"] = await measure(() => account.changeGuardian(randomAddress()));

  return report;
};

// passing unknown because typechain doesn't support zksync
const measure = async (test: () => Promise<unknown>) => {
  const response = (await test()) as TransactionResponse;
  const { gasUsed } = await response.waitFinalize();
  return gasUsed;
};

const formatReport = (report: Record<string, BigNumber>) =>
  Object.entries(report)
    .map(([name, gasUsed]) => `${name}: ${formatGas(gasUsed)}`)
    .join("\n");

// rounding to the nearest 1000 gas allows not being too bothered by minor gas changes and is
// currently needed for contract deployments whose costs are not deterministic
const formatGas = (gasUsed: BigNumber) => {
  const gasRounded = Math.round(gasUsed.toNumber() / 1000) * 1000;
  return `${gasRounded.toLocaleString()} gas`;
};

const randomAddress = () => zksync.Wallet.createRandom().address;

const randomSigners = () => {
  const owner = zksync.Wallet.createRandom();
  const guardian = zksync.Wallet.createRandom();
  return { owner, guardian, ownerAddress: owner.address, guardianAddress: guardian.address };
};
