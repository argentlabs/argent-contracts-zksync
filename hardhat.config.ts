import "@nomiclabs/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "chai-as-promised";
import "@matterlabs/hardhat-zksync-deploy";
import "@matterlabs/hardhat-zksync-solc";
import dotenv from "dotenv";

dotenv.config();

module.exports = {
  zksolc: {
    version: "1.2.0",
    compilerSource: "binary",
    settings: {},
  },
  zkSyncDeploy: {
    zkSyncNetwork: "https://zksync2-testnet.zksync.dev",
    ethNetwork: "goerli", // Can also be the RPC URL of the network (e.g. `https://goerli.infura.io/v3/<API_KEY>`)
  },
  networks: {
    hardhat: {
      zksync: true,
    },
  },
  solidity: {
    version: "0.8.16",
  },
  mocha: {
    timeout: 60_000,
  },
};
