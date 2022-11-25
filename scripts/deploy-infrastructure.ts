import "@nomiclabs/hardhat-ethers";
import { saveConfig } from "./config.service";
import { checkDeployerBalance, getDeployer } from "./deployer.service";
import { deployInfrastructure } from "./infrastructure.service";

(async () => {
  const { deployer } = getDeployer();
  await checkDeployerBalance(deployer);
  const { implementation, factory, testDapp } = await deployInfrastructure(deployer);
  await saveConfig({ implementation: implementation.address, factory: factory.address, testDapp: testDapp.address });
})();
