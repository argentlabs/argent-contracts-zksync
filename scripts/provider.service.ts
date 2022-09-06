import * as zksync from "zksync-web3";

export const waitForTimestamp = (timestamp: number, provider: zksync.Provider, timeout: number = 60) =>
  new Promise((resolve, reject) => {
    provider.on("block", async (blockNumber: number) => {
      const block = await provider.getBlock(blockNumber);
      if (block.timestamp >= timestamp) {
        resolve(block);
      }
    });
    setTimeout(reject, timeout * 1000);
  });
