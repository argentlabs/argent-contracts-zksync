import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ZkSyncArtifact } from "@matterlabs/hardhat-zksync-deploy/dist/types";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";

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

export const deployAccount = async (
  argent: ArgentContext,
  signerAddress: string,
  guardianAddress: string,
): Promise<zksync.Contract> => {
  const salt = ethers.constants.HashZero;
  const { factory, implementation } = argent;

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

  const account = await ethers.getContractAt("ArgentAccount", deployedAddress);
  return account;
};

const getAccountAddressFromCreate2 = async (
  { factory, implementation, artifacts }: ArgentContext,
  salt: string,
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
  salt: string,
  signerAddress: string,
  guardianAddress: string,
) => {
  const [address] = await factory.functions.computeCreate2Address(
    salt,
    implementation.address,
    signerAddress,
    guardianAddress,
  );
  return address;
};

export const sendEIP712Transaction = async (
  transaction: zksync.types.TransactionRequest,
  from: string,
  provider: zksync.Provider,
  signer: zksync.Wallet,
  guardian: zksync.Wallet,
) => {
  const { chainId } = await provider.getNetwork();
  const unsignedTransaction = {
    type: zksync.utils.EIP712_TX_TYPE,
    to: transaction.to,
    data: transaction.data ?? "0x",
    value: transaction.value ?? "0x0",
    chainId: transaction.chainId ?? chainId,
    gasPrice: transaction.gasPrice ?? (await provider.getGasPrice()),
    gasLimit: transaction.gasLimit ?? (await provider.estimateGas(transaction)),
    nonce: transaction.nonce ?? (await provider.getTransactionCount(from)),
    customData: {
      ergsPerPubdata: transaction.customData?.ergsPerPubData ?? 0,
      feeToken: transaction.customData?.feeToken ?? zksync.utils.ETH_ADDRESS,
    },
  };

  const signature = ethers.utils.concat([
    await new zksync.EIP712Signer(signer, chainId).sign(unsignedTransaction),
    await new zksync.EIP712Signer(guardian, chainId).sign(unsignedTransaction),
  ]);

  const transactionRequest = {
    ...unsignedTransaction,
    customData: {
      ...unsignedTransaction.customData,
      aaParams: { from, signature },
    },
  };

  const serialized = zksync.utils.serialize(transactionRequest);
  const response = await provider.sendTransaction(serialized);
  const receipt = await response.wait();
  return receipt;
};

export const logBalance = async (provider: zksync.Provider, address: string) => {
  const balance = await provider.getBalance(address);
  console.log(`${address} ETH L2 balance is ${ethers.utils.formatEther(balance)}`);
};
