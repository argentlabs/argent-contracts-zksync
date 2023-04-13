import "@nomiclabs/hardhat-ethers";
import { checkDeployer, getDeployer, verifyContract } from "../src/deployer.service";

(async () => {
  const { deployer } = getDeployer();
  await checkDeployer(deployer);

  const artifact = await deployer.loadArtifact("TestDapp");
  const dapp = await deployer.deploy(artifact);
  console.log("Test dapp deployed to", dapp.address);

  await verifyContract(dapp.address, artifact);
})();
