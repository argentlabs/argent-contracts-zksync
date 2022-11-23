import hre, { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { getEnv } from "./config.service";
import { logBalance } from "./account.service";

export const getDeployer = () => {
  const privateKey = process.env[`PRIVATE_KEY_${getEnv()}`.toUpperCase()];
  if (!privateKey) {
    throw new Error(`Add private key in .env for: ${getEnv()}`);
  }
  const wallet = new zksync.Wallet(privateKey);
  const deployer = new Deployer(hre, wallet);
  const { address, provider } = deployer.zkWallet;

  return { deployer, deployerAddress: address, provider };
};

export const checkDeployerBalance = async ({ zkWallet: { provider, address } }: Deployer) => {
  const balance = await provider.getBalance(address);
  console.log(`Using env "${getEnv()}" and hardhat network "${hre.network.name}"`);
  await logBalance(address, balance, "Deployer");

  if (balance.lt(ethers.utils.parseEther("0.01"))) {
    throw new Error("Deployer has insufficient funds");
  }
};

export const loadArtifacts = async (deployer: Deployer) => ({
  implementation: await deployer.loadArtifact("ArgentAccount"),
  factory: await deployer.loadArtifact("AccountFactory"),
  proxy: await deployer.loadArtifact("Proxy"),
  testDapp: await deployer.loadArtifact("TestDapp"),
  sponsoringPaymaster: await deployer.loadArtifact("SponsoringPaymaster"),
});
