import "@nomiclabs/hardhat-ethers";
import { saveConfig } from "../src/config.service";
import { checkDeployer, getDeployer } from "../src/deployer.service";
import { deployInfrastructure } from "../src/infrastructure.service";

(async () => {
  const { deployer } = getDeployer();
  await checkDeployer(deployer);
  const { implementation, factory } = await deployInfrastructure(deployer);
  await saveConfig({ implementation: implementation.address, factory: factory.address });
})();
