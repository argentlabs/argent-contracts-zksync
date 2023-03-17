import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount } from "../typechain-types";

export enum EscapeStatus {
  None,
  TooEarly,
  Active,
  Expired,
}

export const getEscapeSignature = async (
  newSigner: zksync.Wallet,
  account: ArgentAccount,
  method: "triggerEscapeOwner" | "triggerEscapeGuardian",
) => {
  const selector = account.interface.getSighash(method);
  const { chainId } = await account.provider.getNetwork();
  // const nonce = await account.provider.getTransactionCount(account.address);
  const nonce = 0;
  const message = ethers.utils.solidityPack(
    ["bytes4", "uint256", "address", "uint256", "address"],
    [selector, chainId, account.address, nonce, newSigner.address],
  );
  const messageHash = ethers.utils.arrayify(ethers.utils.keccak256(message));
  return newSigner.signMessage(messageHash);
};

export const triggerEscapeGuardian = async (newGuardian: zksync.Wallet, account: ArgentAccount) => {
  // const signature = await getEscapeSignature(newGuardian, account, "triggerEscapeGuardian");
  return account.triggerEscapeGuardian(newGuardian.address);
};

export const triggerEscapeOwner = async (newOwner: zksync.Wallet, account: ArgentAccount) => {
  // const signature = await getEscapeSignature(newOwner, account, "triggerEscapeOwner");
  return account.triggerEscapeOwner(newOwner.address);
};
