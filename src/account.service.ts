import { BigNumber, BytesLike, PopulatedTransaction } from "ethers";
import hre, { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount, IMulticall } from "../typechain-types";
import { verifyContract } from "./deployer.service";
import {
  AccountDeploymentParams,
  ArgentInfrastructure,
  ProxyAccountDeploymentParams,
  TransactionResponse,
} from "./model";
import { ArgentSigner, Signatory } from "./signer.service";

export const argentAccountAt = (proxyAddress: string, argent: ArgentInfrastructure, signatories?: Signatory[]) => {
  const { provider } = argent.deployer.zkWallet;
  const account = new zksync.Contract(proxyAddress, argent.implementation.interface, provider) as ArgentAccount;
  if (signatories) {
    return connect(account, signatories);
  }
  return account;
};

export const deployProxyAccount = async ({
  argent,
  ownerAddress,
  guardianAddress,
  salt = ethers.utils.randomBytes(32),
  overrides = {},
}: ProxyAccountDeploymentParams): Promise<TransactionResponse> => {
  const { factory, implementation } = argent;
  const response = await factory.deployProxyAccount(
    salt,
    implementation.address,
    ownerAddress,
    guardianAddress,
    overrides,
  );
  return response as TransactionResponse;
};

export const deployAccount = async ({
  argent,
  ownerAddress,
  guardianAddress,
  connect: signatories,
  funds = undefined,
  salt,
}: AccountDeploymentParams): Promise<ArgentAccount> => {
  const { deployer, implementation, artifacts } = argent;

  const response = await deployProxyAccount({ argent, ownerAddress, guardianAddress, salt });
  const receipt = await response.wait();
  const [{ deployedAddress }] = zksync.utils.getDeployedContracts(receipt);
  const account = argentAccountAt(deployedAddress, argent, signatories);

  const initData = implementation.interface.encodeFunctionData("initialize", [ownerAddress, guardianAddress]);
  await verifyContract(account.address, artifacts.proxy, [implementation.address, initData]);

  if (hre.network.name === "local" && funds === undefined) {
    funds = "0.001";
  }
  if (funds) {
    const response = await deployer.zkWallet.transfer({ to: account.address, amount: ethers.utils.parseEther(funds) });
    await response.wait();
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

export const makeCall = ({
  to,
  value = BigNumber.from(0),
  data = "0x",
}: PopulatedTransaction): IMulticall.CallStruct => {
  if (!to) {
    throw new Error(`Transaction 'to' is required, was ${to}`);
  }
  return { to, value, data };
};

export const logBalance = async (address: string, balanceOrProvider: zksync.Provider | BigNumber, name?: string) => {
  const balance = "getBalance" in balanceOrProvider ? await balanceOrProvider.getBalance(address) : balanceOrProvider;
  console.log(name ? `${name} at ${address}` : address, `has balance ${ethers.utils.formatEther(balance)}`);
};
