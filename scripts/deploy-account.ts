import "@nomiclabs/hardhat-ethers";
import hre, { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { deployAccount, logBalance } from "../test-integration/account.service";

(async () => {
  const implementationAddress = "0x95DA55F2C6d9e21CEa31E671b2Dd5a539463e47F";
  const factoryAddress = "0xF247bf62a26C7Fd175604d8257E11b0d258Cc4db";

  const ownerAddress = "0x1111111111111111111111111111111111111111";
  const guardianAddress = "0x2222222222222222222222222222222222222222";

  const deployer = new Deployer(hre, new zksync.Wallet(process.env.PRIVATE_KEY as string));
  const { provider } = deployer.zkWallet;

  await logBalance(deployer.zkWallet.address, provider, "Deployer");

  const artifacts = {
    implementation: await deployer.loadArtifact("ArgentAccount"),
    factory: await deployer.loadArtifact("AccountFactory"),
    proxy: await deployer.loadArtifact("Proxy"),
  };

  const implementation = new zksync.Contract(implementationAddress, artifacts.implementation.abi);
  const factory = new zksync.Contract(factoryAddress, artifacts.factory.abi, deployer.zkWallet);
  const argent = { deployer, artifacts, implementation, factory };

  const account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
  console.log("account deployed to", account.address);
})();
