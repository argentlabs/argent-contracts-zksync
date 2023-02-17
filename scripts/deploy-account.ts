import "@nomiclabs/hardhat-ethers";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { deployAccount } from "./account.service";
import { checkDeployer, getDeployer } from "./deployer.service";
import { getInfrastructure } from "./infrastructure.service";

(async () => {
  const { deployer } = getDeployer();
  await checkDeployer(deployer);
  const argent = await getInfrastructure(deployer);

  const owner = zksync.Wallet.createRandom();
  console.log(`Using owner private key: ${owner.privateKey}`);
  const ownerAddress = owner.address;
  const guardianAddress = ethers.constants.AddressZero;

  const account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
  console.log("Argent account deployed to", account.address);
})();
