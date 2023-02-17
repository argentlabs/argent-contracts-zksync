import { TransactionReceipt } from "@ethersproject/abstract-provider";
import "@nomiclabs/hardhat-ethers";
import { BigNumberish } from "ethers";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { deployAccount } from "../src/account.service";
import { checkDeployer, getDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";

const ethusd = 1650;

const formatUsd = (value: BigNumberish) => `$${ethers.utils.formatEther(value)}`.slice(0, 5);

const toRow = (name: string, receipt: TransactionReceipt) => {
  const { gasUsed, effectiveGasPrice } = receipt;
  const fee = gasUsed.mul(effectiveGasPrice);
  return {
    name,
    gasUsed: gasUsed.toNumber(),
    fee: `${ethers.utils.formatEther(fee)} ETH`,
    feeUsd: formatUsd(fee.mul(ethusd)),
    hash: receipt.transactionHash,
  };
};

(async () => {
  const { deployer, provider } = getDeployer();
  await checkDeployer(deployer);
  const argent = await getTestInfrastructure(deployer);

  const eoa1 = zksync.Wallet.createRandom().connect(provider);
  const eoa2 = zksync.Wallet.createRandom().connect(provider);
  const owner = zksync.Wallet.createRandom();
  const guardian = zksync.Wallet.createRandom();

  console.log(`Using owner private key: ${owner.privateKey}`);
  console.log(`Using guardian private key: ${guardian.privateKey}`);
  const ownerAddress = owner.address;
  const guardianAddress = guardian.address;
  // const guardianAddress = ethers.constants.AddressZero;

  const feeData = await deployer.zkWallet.provider.getFeeData();
  console.log(`gasPrice: ${ethers.utils.formatUnits(feeData.gasPrice!, "gwei")} gwei`);

  const wallet = deployer.zkWallet;
  const balanceBefore = await wallet.getBalance();

  const connect = [owner, guardian];
  const account1 = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false, connect });
  console.log("Argent account 1 deployed to", account1.address);
  const account2 = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false, connect });
  console.log("Argent account 2 deployed to", account2.address);

  console.log("funding accounts");
  const funds = "0.0005";
  let response1 = await wallet.sendTransaction({ to: eoa1.address, value: ethers.utils.parseEther(funds) });
  let response2 = await wallet.sendTransaction({ to: eoa2.address, value: ethers.utils.parseEther(funds) });
  let response3: any = await wallet.sendTransaction({ to: account1.address, value: ethers.utils.parseEther(funds) });
  let response4: any = await wallet.sendTransaction({ to: account2.address, value: ethers.utils.parseEther(funds) });
  await Promise.all([response1.wait(), response2.wait(), response3.wait(), response4.wait()]);

  console.log("warming accounts");
  response1 = await eoa1.sendTransaction({ to: wallet.address, value: 1 });
  response2 = await eoa2.sendTransaction({ to: wallet.address, value: 1 });
  response3 = await account1.signer.sendTransaction({ to: wallet.address, value: 1 });
  response4 = await account2.signer.sendTransaction({ to: wallet.address, value: 1 });
  await Promise.all([response1.wait(), response2.wait(), response3.wait(), response4.wait()]);

  console.log("testing");
  const rows = [];
  let response, receipt;

  response = await eoa1.sendTransaction({ to: eoa2.address, value: 51 });
  receipt = await response.wait();
  rows.push(toRow("EOA -> EOA", receipt));

  response = await eoa1.sendTransaction({ to: account1.address, value: 52 });
  receipt = await response.wait();
  rows.push(toRow("EOA -> ArgentAccount", receipt));

  response = await account1.signer.sendTransaction({ to: eoa1.address, value: 53 });
  receipt = await response.wait();
  rows.push(toRow("ArgentAccount -> EOA", receipt));

  response = await account1.signer.sendTransaction({ to: account2.address, value: 54 });
  receipt = await response.wait();
  rows.push(toRow("ArgentAccount -> ArgentAccount", receipt));

  console.table(rows);

  const balanceAfter = await wallet.getBalance();
  const cost = balanceBefore.sub(balanceAfter);
  console.log(`Total testing cost: ${ethers.utils.formatEther(cost)} ETH, ${formatUsd(cost.mul(ethusd))}`);
})();
