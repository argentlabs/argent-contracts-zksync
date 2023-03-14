import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ZkSyncArtifact } from "@matterlabs/hardhat-zksync-deploy/dist/types";
import { ethers } from "ethers";
import hre from "hardhat";
import * as zksync from "zksync-web3";
import { logBalance } from "./account.service";
import { ArgentArtifacts } from "./model";

let showPreamble = true;

export const getDeployer = () => {
  let privateKey;
  const network = hre.network.name;
  if (network === "zkSyncMainnet") {
    privateKey = process.env[`PRIVATE_KEY_MAINNET`];
  } else if (network === "zkSyncTestnet") {
    privateKey = process.env[`PRIVATE_KEY_GOERLI`];
  } else if (network === "local") {
    try {
      [{ privateKey }] = require("../local-setup/rich-wallets.json");
    } catch {}
  }
  if (!privateKey) {
    throw new Error(`Add private key in .env for network ${network}`);
  }
  const wallet = new zksync.Wallet(privateKey);
  const deployer = new Deployer(hre, wallet);
  const { address, provider } = deployer.zkWallet;

  return { deployer, deployerAddress: address, provider };
};

export const checkDeployer = async ({ zkWallet: { provider, providerL1, address } }: Deployer) => {
  try {
    if (showPreamble) {
      console.log(`Using hardhat network "${hre.network.name}"`);
    }

    const balance = await provider.getBalance(address);
    if (showPreamble) {
      await logBalance(address, balance, "Deployer");
      let feeData = await provider.getFeeData();
      console.log(`L2 gas price ${ethers.utils.formatUnits(feeData.gasPrice!, "gwei")} gwei`);
      feeData = await providerL1!.getFeeData();
      console.log(`L1 gas price ${ethers.utils.formatUnits(feeData.gasPrice!, "gwei")} gwei`);
      console.log();
      showPreamble = false;
    }

    if (balance.lt(ethers.utils.parseEther("0.005"))) {
      throw new Error("Deployer has very low funds");
    }
  } catch (error) {
    if (`${error}`.includes("noNetwork") && hre.network.name === "local") {
      console.error(error);
      console.error("\nRun `yarn start` to start the local zkSync node.\n");
      process.exit(1);
    } else {
      throw error;
    }
  }
};

export const loadArtifacts = async (deployer: Deployer): Promise<ArgentArtifacts> => ({
  implementation: await deployer.loadArtifact("ArgentAccount"),
  factory: await deployer.loadArtifact("AccountFactory"),
  proxy: await deployer.loadArtifact("Proxy"),
  testDapp: await deployer.loadArtifact("TestDapp"),
});

// Temporary hack while waiting for `hardhat-zksync-deploy` to be updated
export class CustomDeployer extends Deployer {
  constructor(signer: ethers.Signer & { provider: ethers.providers.Provider }) {
    super(hre, zksync.Wallet.createRandom());
    this.zkWallet = signer.connect(signer.provider) as any;
  }

  public async estimateDeployGas(artifact: ZkSyncArtifact, constructorArguments: any[]): Promise<ethers.BigNumber> {
    const factoryDeps = await this.extractFactoryDeps(artifact);
    const factory = new zksync.ContractFactory(artifact.abi, artifact.bytecode, this.zkWallet);

    // Encode deploy transaction so it can be estimated.
    const deployTx = factory.getDeployTransaction(...constructorArguments, {
      customData: {
        factoryDeps,
      },
    });
    deployTx.from = await this.zkWallet.getAddress();

    return await this.zkWallet.provider.estimateGas(deployTx);
  }
}

export const verifyContract = async (
  address: string,
  { contractName, sourceName }: ZkSyncArtifact,
  constructorArguments: unknown[] = [],
) => {
  const network = hre.config.networks[hre.network.name];
  if (network.verifyURL) {
    const fullyQualifiedName = `${sourceName}:${contractName}`;
    console.log(`Verifying source code of ${fullyQualifiedName} on zkSync explorer`);
    await hre.run("verify:verify", { address, contract: fullyQualifiedName, constructorArguments });
  }
};
