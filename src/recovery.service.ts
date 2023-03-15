import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount } from "../typechain-types";

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
