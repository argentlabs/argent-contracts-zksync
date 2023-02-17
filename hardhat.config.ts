import "@matterlabs/hardhat-zksync-deploy";
import "@matterlabs/hardhat-zksync-solc";
import "@matterlabs/hardhat-zksync-verify";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "chai-as-promised";
import "dotenv/config";

module.exports = {
  zksolc: {
    version: "1.3.4",
    compilerSource: "binary",
    settings: {
      isSystem: true,
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
