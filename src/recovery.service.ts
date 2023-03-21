import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount } from "../typechain-types";

export const signChangeOwner = async (newOwner: zksync.Wallet, account: ArgentAccount) => {
  const selector = account.interface.getSighash("changeOwner");
  const { chainId } = await account.provider.getNetwork();
  const oldOwner = await account.owner();
  const message = ethers.utils.solidityPack(
    ["bytes4", "uint256", "address", "address"],
    [selector, chainId, account.address, oldOwner],
  );
  const messageHash = ethers.utils.arrayify(ethers.utils.keccak256(message));
  return newOwner.signMessage(messageHash);
};

export const changeOwnerWithSignature = async (newOwner: zksync.Wallet, account: ArgentAccount) => {
  const signature = await signChangeOwner(newOwner, account);
  return account.changeOwner(newOwner.address, signature);
};
