import "@nomiclabs/hardhat-ethers";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { argentAccountContract, connect } from "./account.service";
import { checkDeployer, getDeployer } from "./deployer.service";
import { getInfrastructure } from "./infrastructure.service";

const drainAccountBalance = async () => {
  const { deployer, provider } = getDeployer();
  await checkDeployer(deployer);
  const argent = await getInfrastructure(deployer);

  const accountAddress = "0x0000000000000000000000000000000000000000";
  const ownerPrivateKey = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const guardianPrivateKey = "0x0000000000000000000000000000000000000000000000000000000000000000";

  // const signatories = [new zksync.Wallet(ownerPrivateKey)];
  const signatories = [new zksync.Wallet(ownerPrivateKey), new zksync.Wallet(guardianPrivateKey)];

  const account = connect(argentAccountContract(accountAddress, argent), signatories);

  const balance = await provider.getBalance(account.address);
  console.log(`balance ${ethers.utils.formatEther(balance)}`);

  const gas = await account.signer.estimateGas({ to: deployer.zkWallet.address, value: 1 });
  console.log(`gas ${gas}`);
  const feeData = await provider.getFeeData();
  if (!feeData.gasPrice) {
    throw new Error("feeData.gasPrice is undefined");
  }
  console.log(`gasPrice ${ethers.utils.formatEther(feeData.gasPrice)}`);
  const fee = feeData.gasPrice.mul(gas).mul(1005).div(1000);
  console.log(`fee ${ethers.utils.formatEther(fee)}`);
  const value = balance.sub(fee);
  console.log(`value = balance - fee ${ethers.utils.formatEther(value)}`);
  const response = await account.signer.sendTransaction({ to: deployer.zkWallet.address, value });
  console.log(`https://explorer.zksync.io/tx/${response.hash}`);
  await response.wait();
};

(async () => {
  await drainAccountBalance();
})();
