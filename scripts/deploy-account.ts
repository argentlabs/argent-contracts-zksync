import "@nomiclabs/hardhat-ethers";
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
  const guardianAddress = "0x2222222222222222222222222222222222222222";

  const account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
  console.log("Argent account deployed to", account.address);
})();
