import hre, { ethers } from "hardhat";
import { BytesLike } from "ethers";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ZkSyncArtifact } from "@matterlabs/hardhat-zksync-deploy/dist/types";
import * as zksync from "zksync-web3";
import { MultiSigner, Signatories } from "./signer.service";

export interface ArgentContext {
  deployer: Deployer;
  artifacts: ArgentArtifacts;
  implementation: zksync.Contract;
  factory: zksync.Contract;
}

export interface ArgentArtifacts {
  implementation: ZkSyncArtifact;
  factory: ZkSyncArtifact;
  proxy: ZkSyncArtifact;
}

interface AccountDeploymentParams {
  argent: ArgentContext;
  signerAddress: string;
  guardianAddress: string;
  signers?: Signatories;
  funded?: boolean;
  salt?: BytesLike;
}

export const deployAccount = async ({
  argent,
  signerAddress,
  guardianAddress,
  signers,
  funded = true,
  salt = ethers.utils.randomBytes(32),
}: AccountDeploymentParams): Promise<ArgentAccount> => {
  const { deployer, factory, implementation } = argent;

  const create2Address = await getAccountAddressFromCreate2(argent, salt, signerAddress, guardianAddress);
  const factoryAddress = await getAccountAddressFromFactory(argent, salt, signerAddress, guardianAddress);

  const tx = await factory.deployProxyAccount(salt, implementation.address, signerAddress, guardianAddress);
  const receipt = await tx.wait();
  const [{ deployedAddress }] = zksync.utils.getDeployedContracts(receipt);

  if (deployedAddress !== create2Address) {
    throw new Error(`Deployed address (${deployedAddress}) != address predicted from create2 (${create2Address})`);
  }

  if (deployedAddress !== factoryAddress) {
    throw new Error(`Deployed address (${deployedAddress}) != address predicted from factory (${factoryAddress})`);
  }

  // make sure account doesn't have a signer by default
  const provider = new zksync.Provider(hre.config.zkSyncDeploy.zkSyncNetwork);
  const account = new ArgentAccount(deployedAddress, argent.implementation.interface, provider);

  if (funded) {
    const response = await deployer.zkWallet.transfer({
      to: account.address,
      amount: ethers.utils.parseEther("0.0001"),
    });
    await response.wait();
  }

  if (signers) {
    return account.connectSigners(...signers);
  }

  return account;
};

const getAccountAddressFromCreate2 = async (
  { factory, implementation, artifacts }: ArgentContext,
  salt: BytesLike,
  signerAddress: string,
  guardianAddress: string,
) => {
  const initData = implementation.interface.encodeFunctionData("initialize", [signerAddress, guardianAddress]);

  const proxyInterface = new ethers.utils.Interface(artifacts.proxy.abi);
  const constructorData = proxyInterface.encodeDeploy([implementation.address, initData]);

  const proxyBytecodeHash = zksync.utils.hashBytecode(artifacts.proxy.bytecode);
  return zksync.utils.create2Address(factory.address, proxyBytecodeHash, salt, constructorData);
};

const getAccountAddressFromFactory = async (
  { factory, implementation }: ArgentContext,
  salt: BytesLike,
  signerAddress: string,
  guardianAddress: string,
) => {
  return await factory.callStatic.computeCreate2Address(salt, implementation.address, signerAddress, guardianAddress);
};

export const logBalance = async (address: string, provider: zksync.Provider, name?: string) => {
  const balance = await provider.getBalance(address);
  console.log(`${name || address} ETH L2 balance is ${ethers.utils.formatEther(balance)}`);
};

export class ArgentAccount extends zksync.Contract {
  connectSigners(...signatories: Signatories) {
    const signer = new MultiSigner(this.address, signatories, this.provider);
    return this.connect(signer) as this;
  }
}
