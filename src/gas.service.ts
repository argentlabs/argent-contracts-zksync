import { exec } from "child_process";
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
  const jsonReport = JSON.stringify(report, null, 2);
  console.log(jsonReport);

  if (mode === "write") {
    fs.writeFileSync("./gas-report.json", jsonReport);
  } else if (mode === "check") {
    fs.writeFileSync("./gas-report-new.json", jsonReport);
    exec("diff gas-report.json gas-report-new.json", (err, stdout, stderr) => {
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
  const report: Record<string, string> = {};

  let response, account: ArgentAccount, owner, guardian, ownerAddress: string, guardianAddress: string;

  console.log("Infrastructure deployment");

  report.deployImplementation = await measure(async () => {
    const [implementation] = await deployImplementation(deployer);
    argentPartial.implementation = implementation;
    return implementation.deployTransaction;
  });

  report.deployFactory = await measure(async () => {
    const [factory] = await deployFactory(deployer);
    argentPartial.factory = factory;
    return factory.deployTransaction;
  });

  const argent = argentPartial as ArgentInfrastructure;

  const newAccount = async () => {
    ({ owner, guardian, ownerAddress, guardianAddress } = randomSigners());
    let [response, account] = await deployProxyAccount({ argent, ownerAddress, guardianAddress });
    account = connect(account, [owner, guardian]);
    response = await deployer.zkWallet.sendTransaction({ to: account.address, value: ethers.utils.parseEther("1") });
    await response.waitFinalize();
    return account;
  };

  console.log("Account deployment");

  ({ ownerAddress, guardianAddress } = randomSigners());
  report.deployAccount = await measure(async () => {
    [response] = await deployProxyAccount({ argent, ownerAddress, guardianAddress });
    return response;
  });

  console.log("Transactions");

  account = await newAccount();
  report.transferETH = await measure(() => account.signer.sendTransaction({ to: randomAddress(), value: 1 }));

  report.multicall2transfers = await measure(() =>
    account.multicall([
      { to: randomAddress(), value: 1, data: "0x" },
      { to: randomAddress(), value: 1, data: "0x" },
    ]),
  );

  console.log("Recovery");

  report.changeOwner = await measure(() => changeOwnerWithSignature(zksync.Wallet.createRandom(), account));

  account = await newAccount();
  report.changeGuardian = await measure(() => account.changeGuardian(randomAddress()));

  return report;
};

const measure = async (test: () => Promise<unknown>) => {
  const response = (await test()) as TransactionResponse;
  const { gasUsed } = await response.waitFinalize();
  const gasRounded = Math.round(gasUsed.toNumber() / 1000) * 1000;
  return `${gasRounded.toLocaleString()} gas`;
};

const randomAddress = () => zksync.Wallet.createRandom().address;

const randomSigners = () => {
  const owner = zksync.Wallet.createRandom();
  const guardian = zksync.Wallet.createRandom();
  return { owner, guardian, ownerAddress: owner.address, guardianAddress: guardian.address };
};
