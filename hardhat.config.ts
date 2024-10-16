import "@matterlabs/hardhat-zksync-deploy";
import "@matterlabs/hardhat-zksync-solc";
import "@matterlabs/hardhat-zksync-verify";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "chai-as-promised";
import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";
// import "hardhat-storage-layout"; // uncomment when using the script as it slows things down otherwise

const config: HardhatUserConfig = {
  zksolc: {
    version: "1.3.8",
    compilerSource: "binary",
    settings: {
      isSystem: true,
      optimizer: {
        mode: "z",
      },
    },
  },
  defaultNetwork: "local",
  networks: {
    hardhat: {
      zksync: true,
    },
    local: {
      url: "http://localhost:3050",
      ethNetwork: "http://localhost:8545",
      zksync: true,
    },
    zkSyncTestnet: {
      url: "https://zksync2-testnet.zksync.dev",
      ethNetwork: `https://eth-goerli.alchemyapi.io/v2/${process.env.ALCHEMY_KEY}`,
      verifyURL: "https://zksync2-testnet-explorer.zksync.dev/contract_verification",
      zksync: true,
    },
    zkSyncMainnet: {
      url: "https://zksync2-mainnet.zksync.io",
      ethNetwork: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_KEY}`,
      verifyURL: "https://zksync2-mainnet-explorer.zksync.io/contract_verification",
      zksync: true,
    },
  },
  solidity: {
    version: "0.8.18",
  },
  mocha: {
    timeout: 2 * 60e3, // milliseconds
  },
};

export default config;
