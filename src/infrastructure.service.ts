import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import hre from "hardhat";
import * as zksync from "zksync-web3";
import { AccountFactory, ArgentAccount, TestDapp } from "../typechain-types";
import { loadConfig } from "./config.service";
import { checkDeployer, loadArtifacts, verifyContract } from "./deployer.service";
import { ArgentInfrastructure } from "./model";

export const deployInfrastructure = async (deployer: Deployer): Promise<ArgentInfrastructure> => {
  const artifacts = await loadArtifacts(deployer);

  const [implementation, implementationArguments] = await deployImplementation(deployer);
  console.log(`Account implementation deployed to ${implementation.address}`);
  await verifyContract(implementation.address, artifacts.implementation, implementationArguments);

  const [factory, factoryArguments] = await deployFactory(deployer);
  console.log(`Account factory deployed to ${factory.address}\n`);
  await verifyContract(factory.address, artifacts.factory, factoryArguments);

  return { deployer, artifacts, implementation, factory };
};

export const deployImplementation = async (deployer: Deployer): Promise<[ArgentAccount, unknown[]]> => {
  const { escapeSecurityPeriodInSeconds } = await loadConfig();
  const artifact = await deployer.loadArtifact("ArgentAccount");
  const constructorArguments = [escapeSecurityPeriodInSeconds];
  const implementation = await deployer.deploy(artifact, constructorArguments);
  return [implementation as ArgentAccount, constructorArguments];
};

export const deployFactory = async (deployer: Deployer): Promise<[AccountFactory, unknown[]]> => {
  const artifacts = await loadArtifacts(deployer);
  const proxyBytecode = artifacts.proxy.bytecode;
  const constructorArguments = [zksync.utils.hashBytecode(proxyBytecode)];
  const factory = await deployer.deploy(artifacts.factory, constructorArguments, undefined, [proxyBytecode]);
  return [factory as AccountFactory, constructorArguments];
};

export const getInfrastructure: typeof deployInfrastructure = async (deployer) => {
  const config = await loadConfig();
  const artifacts = await loadArtifacts(deployer);

  if (!config.implementation || !config.factory) {
    throw new Error("Infrastructure not deployed");
  }

  const wallet = deployer.zkWallet;
  const implementation = new zksync.Contract(config.implementation, artifacts.implementation.abi, wallet.provider);
  const factory = new zksync.Contract(config.factory, artifacts.factory.abi, wallet) as AccountFactory;

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
