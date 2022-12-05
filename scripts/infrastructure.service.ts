import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import * as zksync from "zksync-web3";
import { AccountFactory, ArgentAccount, TestDapp } from "../typechain-types";
import { deployAccount } from "./account.service";
import { getEnv, loadConfig } from "./config.service";
import { checkDeployer, loadArtifacts } from "./deployer.service";
import { ArgentInfrastructure } from "./model";

export const deployInfrastructure = async (deployer: Deployer): Promise<ArgentInfrastructure> => {
  const config = await loadConfig();
  const artifacts = await loadArtifacts(deployer);

  const implementation = await deployer.deploy(artifacts.implementation, [config.escapeSecurityPeriodInSeconds]);
  console.log(`Account implementation deployed to ${implementation.address}`);

  const { bytecode } = artifacts.proxy;
  const proxyBytecodeHash = zksync.utils.hashBytecode(bytecode);
  const factory = await deployer.deploy(artifacts.factory, [proxyBytecodeHash], undefined, [bytecode]);
  console.log(`Account factory deployed to ${factory.address}`);

  const argent = { deployer, artifacts, implementation, factory: factory as AccountFactory };

  // deploying a dummy account here in order pay for L1 data costs here and not
  // during the deployment of the first actual wallet
  const dummyAccount = await deployAccount({
    argent,
    ownerAddress: zksync.Wallet.createRandom().address,
    guardianAddress: zksync.Wallet.createRandom().address,
    funds: false,
  });
  console.log(`Dummy account deployed to: ${dummyAccount.address}`);

  return { ...argent, dummyAccount };
};

export const getInfrastructure: typeof deployInfrastructure = async (deployer) => {
  const config = await loadConfig();
  const artifacts = await loadArtifacts(deployer);

  if (!config.implementation || !config.factory) {
    throw new Error("Infrastructure not deployed");
  }

  const implementation = new zksync.Contract(config.implementation, artifacts.implementation.abi);
  const factory = new zksync.Contract(config.factory, artifacts.factory.abi, deployer.zkWallet) as AccountFactory;
  const dummyAccount = new zksync.Contract(config.dummyAccount, artifacts.implementation.abi) as ArgentAccount;
  const testDapp = new zksync.Contract(config.testDapp, artifacts.testDapp.abi, deployer.zkWallet.provider) as TestDapp;

  return { deployer, artifacts, implementation, factory, dummyAccount, testDapp };
};

let testInfrastructure: ArgentInfrastructure | undefined;

export const getTestInfrastructure: typeof deployInfrastructure = async (deployer) => {
  if (testInfrastructure) {
    return testInfrastructure;
  }
  await checkDeployer(deployer);
  if (getEnv() !== "local") {
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
