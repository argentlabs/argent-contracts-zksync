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
  ownerAddress: string;
  guardianAddress: string;
  connect?: Signatories;
  funds?: false | string;
  salt?: BytesLike;
}

export const deployAccount = async ({
  argent,
  ownerAddress,
  guardianAddress,
  connect,
  funds = "0.0001",
  salt = ethers.utils.randomBytes(32),
}: AccountDeploymentParams): Promise<ArgentAccount> => {
  const { deployer, factory, implementation } = argent;

  const create2Address = await getAccountAddressFromCreate2(argent, salt, ownerAddress, guardianAddress);
  const factoryAddress = await getAccountAddressFromFactory(argent, salt, ownerAddress, guardianAddress);

  const tx = await factory.deployProxyAccount(salt, implementation.address, ownerAddress, guardianAddress);
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

  if (funds) {
    const response = await deployer.zkWallet.transfer({
      to: account.address,
      amount: ethers.utils.parseEther(funds),
    });
    await response.wait();
  }

  if (connect) {
    return account.connect(connect);
  }

  return account;
};

const getAccountAddressFromCreate2 = async (
  { factory, implementation, artifacts }: ArgentContext,
  salt: BytesLike,
  ownerAddress: string,
  guardianAddress: string,
) => {
  const initData = implementation.interface.encodeFunctionData("initialize", [ownerAddress, guardianAddress]);

  const proxyInterface = new ethers.utils.Interface(artifacts.proxy.abi);
  const constructorData = proxyInterface.encodeDeploy([implementation.address, initData]);

  const proxyBytecodeHash = zksync.utils.hashBytecode(artifacts.proxy.bytecode);
  return zksync.utils.create2Address(factory.address, proxyBytecodeHash, salt, constructorData);
};

const getAccountAddressFromFactory = async (
  { factory, implementation }: ArgentContext,
  salt: BytesLike,
  ownerAddress: string,
  guardianAddress: string,
) => {
  return await factory.callStatic.computeCreate2Address(salt, implementation.address, ownerAddress, guardianAddress);
};

export const logBalance = async (address: string, provider: zksync.Provider, name?: string) => {
  const balance = await provider.getBalance(address);
  console.log(name ? `${name} at ${address}` : address, `ETH L2 balance is ${ethers.utils.formatEther(balance)}`);
};

export class ArgentAccount extends zksync.Contract {
  connect(signerOrSignersOrProvider: any) {
    if (Array.isArray(signerOrSignersOrProvider)) {
      const signer = new MultiSigner(this.address, signerOrSignersOrProvider, this.provider);
      return super.connect(signer) as this;
    }
    return super.connect(signerOrSignersOrProvider) as this;
  }
}
