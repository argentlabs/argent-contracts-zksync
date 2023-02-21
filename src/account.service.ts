import { BigNumber, BytesLike } from "ethers";
import hre, { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount } from "../typechain-types";
import { verifyContract } from "./deployer.service";
import { AccountDeploymentParams, ArgentInfrastructure } from "./model";
import { ArgentSigner, Signatory } from "./signer.service";

export const argentAccountContract = (deployedAddress: string, argent: ArgentInfrastructure) => {
  const { provider } = argent.deployer.zkWallet;
  const account = new zksync.Contract(deployedAddress, argent.implementation.interface, provider) as ArgentAccount;
  return account;
};

export const deployAccount = async ({
  argent,
  ownerAddress,
  guardianAddress,
  connect: signatories,
  funds = undefined,
  salt = ethers.utils.randomBytes(32),
}: AccountDeploymentParams): Promise<ArgentAccount> => {
  const { deployer, factory, implementation, artifacts } = argent;

  const response = await factory.deployProxyAccount(salt, implementation.address, ownerAddress, guardianAddress);
  const receipt = await response.wait();
  const [{ deployedAddress }] = zksync.utils.getDeployedContracts(receipt);
  const initData = implementation.interface.encodeFunctionData("initialize", [ownerAddress, guardianAddress]);
  await verifyContract(deployedAddress, artifacts.proxy, [implementation.address, initData]);

  const account = argentAccountContract(deployedAddress, argent);

  if (hre.network.name === "local" && funds === undefined) {
    funds = "0.001";
  }
  if (funds) {
    const response = await deployer.zkWallet.transfer({
      to: account.address,
      amount: ethers.utils.parseEther(funds),
    });
    await response.wait();
  }

  if (signatories) {
    return connect(account, signatories);
  }

  return account;
};

export const connect = (account: ArgentAccount, signatories: Signatory[]): ArgentAccount =>
  account.connect(new ArgentSigner(account, signatories));

export const computeCreate2AddressFromSdk = (
  { factory, implementation, artifacts }: ArgentInfrastructure,
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

export const logBalance = async (address: string, balanceOrProvider: zksync.Provider | BigNumber, name?: string) => {
  const balance = "getBalance" in balanceOrProvider ? await balanceOrProvider.getBalance(address) : balanceOrProvider;
  console.log(name ? `${name} at ${address}` : address, `has balance ${ethers.utils.formatEther(balance)}`);
};
