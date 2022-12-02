import { BigNumber, BytesLike } from "ethers";
import hre, { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount } from "../typechain-types";
import { AccountDeploymentParams, ArgentInfrastructure } from "./model";
import { MultiSigner, Signatories } from "./signer.service";

export const deployAccount = async ({
  argent,
  ownerAddress,
  guardianAddress,
  connect: signatories,
  funds = "0.0001",
  salt = ethers.utils.randomBytes(32),
}: AccountDeploymentParams): Promise<ArgentAccount> => {
  const { deployer, factory, implementation } = argent;

  const response = await factory.deployProxyAccount(salt, implementation.address, ownerAddress, guardianAddress);
  const receipt = await response.wait();
  const [{ deployedAddress }] = zksync.utils.getDeployedContracts(receipt);

  // make sure account doesn't have a signer by default
  const provider = new zksync.Provider(hre.config.zkSyncDeploy.zkSyncNetwork);
  const account = new zksync.Contract(deployedAddress, implementation.interface, provider) as ArgentAccount;

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

export const connect = (account: ArgentAccount, signatories: Signatories): ArgentAccount =>
  account.connect(new MultiSigner(account.address, signatories, account.provider));

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
