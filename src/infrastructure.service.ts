import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import hre from "hardhat";
import * as zksync from "zksync-web3";
import { AccountFactory, TestDapp } from "../typechain-types";
import { loadConfig } from "./config.service";
import { checkDeployer, loadArtifacts, verifyContract } from "./deployer.service";
import { ArgentInfrastructure } from "./model";

export const deployInfrastructure = async (deployer: Deployer): Promise<ArgentInfrastructure> => {
  const config = await loadConfig();
  const artifacts = await loadArtifacts(deployer);

  const constructorArguments = [config.escapeSecurityPeriodInSeconds];
  const implementation = await deployer.deploy(artifacts.implementation, constructorArguments);
  console.log(`Account implementation deployed to ${implementation.address}`);
  await verifyContract(implementation.address, artifacts.implementation, constructorArguments);

  const { bytecode } = artifacts.proxy;
  const proxyBytecodeHash = zksync.utils.hashBytecode(bytecode);
  const factory = await deployer.deploy(artifacts.factory, [proxyBytecodeHash], undefined, [bytecode]);
  console.log(`Account factory deployed to ${factory.address}\n`);
  await verifyContract(factory.address, artifacts.factory, [proxyBytecodeHash]);

  return { deployer, artifacts, implementation, factory: factory as AccountFactory };
};

export const getInfrastructure: typeof deployInfrastructure = async (deployer) => {
  const config = await loadConfig();
  const artifacts = await loadArtifacts(deployer);

  if (!config.implementation || !config.factory) {
    throw new Error("Infrastructure not deployed");
  }

  const implementation = new zksync.Contract(config.implementation, artifacts.implementation.abi);
  const factory = new zksync.Contract(config.factory, artifacts.factory.abi, deployer.zkWallet) as AccountFactory;

  return { deployer, artifacts, implementation, factory };
};

let testInfrastructure: ArgentInfrastructure | undefined;

export const getTestInfrastructure: typeof deployInfrastructure = async (deployer) => {
  if (testInfrastructure) {
    return testInfrastructure;
  }
  await checkDeployer(deployer);
  if (hre.network.name !== "local") {
    testInfrastructure = await getInfrastructure(deployer);
  } else {
    testInfrastructure = await deployInfrastructure(deployer);
  }
  return testInfrastructure;
};

export const deployTestDapp = async (deployer: Deployer): Promise<TestDapp> => {
  const artifact = await deployer.loadArtifact("TestDapp");
  const testDapp = await deployer.deploy(artifact);
  return testDapp as TestDapp;
};
