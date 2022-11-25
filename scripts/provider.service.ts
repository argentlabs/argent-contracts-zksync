import * as zksync from "zksync-web3";
import { getEnv } from "./config.service";

export const waitForTimestamp = async (deadline: number, provider: zksync.Provider, timeout: number = 60) => {
  if (getEnv() === "local") {
    throw new Error("Not implemented: evm_increaseTime");
    await provider.send("evm_increaseTime", [deadline]);
    return;
  }
  return new Promise<void>((resolve, reject) => {
    provider.on("block", async (blockNumber: number) => {
      const block = await provider.getBlock(blockNumber);
      if (deadline - block.timestamp >= 5 * 60 * 60) {
        reject("Not waiting more than 5 minutes for deadline");
      } else if (block.timestamp >= deadline) {
        resolve();
      }
    });
    setTimeout(reject, timeout * 1000);
  });
};
