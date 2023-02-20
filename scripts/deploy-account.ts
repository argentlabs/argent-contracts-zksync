import "@nomiclabs/hardhat-ethers";
import * as zksync from "zksync-web3";
import { deployAccount } from "../src/account.service";
import { checkDeployer, getDeployer } from "../src/deployer.service";
import { getInfrastructure } from "../src/infrastructure.service";

(async () => {
  const { deployer } = getDeployer();
  await checkDeployer(deployer);
  const argent = await getInfrastructure(deployer);

  const owner = zksync.Wallet.createRandom();
  const ownerAddress = owner.address;
  console.log(`Using owner private key: ${owner.privateKey}`);

  const guardian = zksync.Wallet.createRandom();
  const guardianAddress = guardian.address;
  console.log(`Using guardian private key: ${guardian.privateKey}`);

  const account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
  console.log("Argent account deployed to", account.address);
})();
