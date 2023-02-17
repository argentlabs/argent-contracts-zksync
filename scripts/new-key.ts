import "@nomiclabs/hardhat-ethers";
import * as zksync from "zksync-web3";

(async () => {
  const wallet = zksync.Wallet.createRandom();
  console.log(`Private key: ${wallet.privateKey}`);
  console.log("Address:", wallet.address);
})();
