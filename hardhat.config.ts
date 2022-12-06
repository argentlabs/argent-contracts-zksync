import "@matterlabs/hardhat-zksync-deploy";
import "@matterlabs/hardhat-zksync-solc";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "chai-as-promised";
import dotenv from "dotenv";
import { getEnv } from "./scripts/config.service";

dotenv.config();

const zkSyncDeploy =
  getEnv() === "local"
    ? {
        zkSyncNetwork: "http://localhost:3050",
        ethNetwork: "http://localhost:8545",
      }
    : {
        zkSyncNetwork: "https://zksync2-testnet.zksync.dev",
        ethNetwork: "goerli", // Can also be the RPC URL of the network (e.g. `https://goerli.infura.io/v3/<API_KEY>`)
      };

module.exports = {
  zksolc: {
    version: "1.2.1",
    compilerSource: "binary",
    settings: {},
  },
  zkSyncDeploy,
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
