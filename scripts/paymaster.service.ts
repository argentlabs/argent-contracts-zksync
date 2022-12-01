import { BigNumberish } from "ethers";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";

export const hashMeaningfulTransaction = (transaction: zksync.types.TransactionRequest) => {
  const data = [
    encodeUint256(transaction.type),
    encodeUint256(transaction.from),
    encodeUint256(transaction.to),
    encodeUint256(transaction.gasLimit),
    encodeUint256(transaction.customData?.ergsPerPubdata),
    encodeUint256(transaction.maxFeePerGas),
    encodeUint256(transaction.maxPriorityFeePerGas),
    encodeUint256(transaction.nonce),
    encodeUint256(transaction.value),
    ethers.utils.keccak256(transaction.data ?? "0x"),
    ethers.utils.keccak256(ethers.utils.hexConcat(transaction.customData?.factoryDeps ?? [])),
  ];
  return ethers.utils.keccak256(ethers.utils.concat(data));
};

const encodeUint256 = (value?: BigNumberish) => {
  // double equals on purpose
  if (value == null) {
    throw new Error("value is null or undefined");
  }
  return ethers.utils.hexZeroPad(ethers.utils.hexlify(value), 32);
};
