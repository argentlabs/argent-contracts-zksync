import { ethers } from "hardhat";
import { ArgentInfrastructure } from "./model";

export const deployPaymaster = async ({ deployer, artifacts, dummyAccount }: ArgentInfrastructure) => {
  const paymaster = await deployer.deploy(artifacts.sponsoringPaymaster, [[], []]);
  console.log(`Paymaster address: ${paymaster.address}`);

  let response = await paymaster.addCodeAndImplementationFromWallet(dummyAccount.address);
  await response.wait();
  console.log("Added code and implementation from dummy acount");

  const value = ethers.utils.parseEther("0.001");
  response = await deployer.zkWallet.sendTransaction({ to: paymaster.address, value });
  await response.wait();
  console.log(`Paymaster supplied with ${ethers.utils.formatEther(value)} ETH`);

  return paymaster;
};
