import "@nomiclabs/hardhat-ethers";
import { saveConfig } from "./config.service";
import { checkDeployer, getDeployer } from "./deployer.service";
import { deployInfrastructure } from "./infrastructure.service";

(async () => {
  const { deployer } = getDeployer();
  await checkDeployer(deployer);
  const { implementation, factory } = await deployInfrastructure(deployer);
  await saveConfig({ implementation: implementation.address, factory: factory.address });
})();
