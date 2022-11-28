import * as zksync from "zksync-web3";
import { TransactionResponse } from "zksync-web3/build/src/types";
import { getEnv } from "./config.service";
import { getDeployer } from "./deployer.service";

type seconds = number;

export const waitForTimestamp = async (deadline: seconds, provider: zksync.Provider, timeout: seconds = 60) => {
  if (getEnv() === "local") {
    return waitForTimestampLocal(deadline, provider, timeout);
  }
  return waitForTimestampPublic(deadline, provider, timeout);
};

export const waitForTimestampLocal = async (deadline: seconds, provider: zksync.Provider, timeout: seconds = 60) => {
  const { deployer, deployerAddress } = getDeployer();
  while (true) {
    const block = await provider.getBlock(await provider.getBlockNumber());
    if (deadline - block.timestamp > timeout) {
      throw new Error("Deadline too long");
    }
    if (block.timestamp >= deadline) {
      return;
    }
    // need to send dummy transactions to mine blocks
    // TODO: use evm_increaseTime when available
    const response = await deployer.zkWallet.sendTransaction({ to: deployerAddress, value: 1 });
    await response.wait();
    await sleep(1);
  }
};

export const waitForTimestampPublic = async (deadline: seconds, provider: zksync.Provider, timeout: seconds = 60) => {
  return new Promise<void>((resolve, reject) => {
    const handleBlock = async (blockNumber: seconds) => {
      const block = await provider.getBlock(blockNumber);
      if (block.timestamp >= deadline) {
        provider.off("block", handleBlock);
        resolve();
      }
    };
    provider.on("block", handleBlock);
    setTimeout(() => {
      provider.off("block", handleBlock);
      reject("Timed out waiting for timestamp");
    }, timeout * 1000);
  });
};

export const waitForL1BatchBlock = async (response: TransactionResponse, provider: zksync.Provider) => {
  const receipt = await response.waitFinalize();
  const range = await provider.getL1BatchBlockRange(receipt.l1BatchNumber);
  if (!range) {
    throw new Error("Batch not found");
  }
  return await provider.getBlock(range[0]);
};

export const sleep = (seconds: seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
