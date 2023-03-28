import "@nomiclabs/hardhat-ethers";
import { ethers } from "hardhat";
import { argentAccountContract } from "../src/account.service";
import { checkDeployer, getDeployer } from "../src/deployer.service";
import { getInfrastructure } from "../src/infrastructure.service";

const callAccount = async () => {
  const { deployer, provider } = getDeployer();
  await checkDeployer(deployer);
  const argent = await getInfrastructure(deployer);

  const accountAddress = "0x543c194572e2cda55C5675f4b171BfE33521fB56";
  const account = argentAccountContract(accountAddress, argent);

  const balance = await provider.getBalance(account.address);
  console.log(`balance ${ethers.utils.formatEther(balance)}`);

  const interfaceId = account.interface.getSighash("multicall");
  console.log(`interfaceId ${interfaceId}`);
  console.log(`supports multicall? ${await account.supportsInterface(interfaceId)}`);
};

(async () => {
  await callAccount();
})();
