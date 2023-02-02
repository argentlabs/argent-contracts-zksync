import "@matterlabs/hardhat-zksync-deploy";
import "@matterlabs/hardhat-zksync-solc";
import "@matterlabs/hardhat-zksync-verify";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "chai-as-promised";
import dotenv from "dotenv";
import { getEnv } from "./scripts/config.service";

dotenv.config();

const zkSyncTestnet =
  getEnv() === "local"
    ? {
        url: "http://localhost:3050",
        ethNetwork: "http://localhost:8545",
        zksync: true,
      }
    : {
        url: "https://zksync2-testnet.zksync.dev",
        ethNetwork: "goerli", // Can also be the RPC URL of the network (e.g. `https://goerli.infura.io/v3/<API_KEY>`)
        zksync: true,
        verifyURL: "https://zksync2-testnet-explorer.zksync.dev/contract_verification",
      };

module.exports = {
  zksolc: {
    version: "1.2.3",
    compilerSource: "binary",
    settings: {},
  },
  defaultNetwork: "zkSyncTestnet",
  networks: {
    hardhat: {
      zksync: true,
    },
    zkSyncTestnet,
  },
  solidity: {
    version: "0.8.16",
  },
  mocha: {
    timeout: 60_000,
  },
};
