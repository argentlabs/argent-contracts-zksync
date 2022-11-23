import { saveConfig } from "./config.service";
import { checkDeployerBalance, getDeployer } from "./deployer.service";
import { getInfrastructure } from "./infrastructure.service";
import { deployPaymaster } from "./paymaster.service";

(async () => {
  const { deployer } = getDeployer();
  await checkDeployerBalance(deployer);
  const argent = await getInfrastructure(deployer);

  const paymaster = await deployPaymaster(argent);
  saveConfig({ sponsoringPaymaster: paymaster.address });
})();
