import "@nomiclabs/hardhat-ethers";
import hre, { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ArgentArtifacts, ArgentContext, deployAccount, logBalance, sendEIP712Transaction } from "./accounts.service";

describe("Argent account", () => {
  let signer: zksync.Wallet;
  let guardian: zksync.Wallet;
  let argent: ArgentContext;

  before(async () => {
    signer = new zksync.Wallet(process.env.PRIVATE_KEY as string);
    guardian = new zksync.Wallet(process.env.GUARDIAN_PRIVATE_KEY as string);
  });

  describe("Infrastructure deployment", () => {
    let deployer: Deployer;
    let artifacts: ArgentArtifacts;
    let implementation: zksync.Contract;
    let factory: zksync.Contract;

    before(async () => {
      deployer = new Deployer(hre, signer);
      artifacts = {
        implementation: await deployer.loadArtifact("ArgentAccount"),
        factory: await deployer.loadArtifact("AccountFactory"),
        proxy: await deployer.loadArtifact("Proxy"),
      };
    });

    it("Should deploy a new ArgentAccount implementation", async () => {
      implementation = await deployer.deploy(artifacts.implementation, []);
      console.log(`Account Implementation was deployed to ${implementation.address}`);
    });

    it("Should deploy a new AccountFactory", async () => {
      const { bytecode } = artifacts.proxy;
      const proxyBytecodeHash = zksync.utils.hashBytecode(bytecode);
      factory = await deployer.deploy(artifacts.factory, [proxyBytecodeHash], undefined, [bytecode]);
      console.log(`Account Factory was deployed to ${factory.address}`);
    });

    after(async () => {
      argent = { deployer, artifacts, implementation, factory };
    });
  });

  describe("Transfers", () => {
    let account1: string;
    let account2: string;

    it("Should deploy a new account (1)", async () => {
      account1 = await deployAccount(argent, signer.address, guardian.address);
      console.log(`Account 1 deployed to ${account1}`);
    });

    it("Should deploy a new account (2)", async () => {
      account2 = await deployAccount(argent, "0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8", guardian.address);
      console.log(`Account 2 deployed to ${account2}`);
    });

    it("Should fund account 1 from signer key", async () => {
      const { zkWallet } = argent.deployer;
      const response = await zkWallet.transfer({
        to: account1,
        amount: ethers.utils.parseEther("0.0001"),
        overrides: {},
      });
      await response.wait();

      await logBalance(zkWallet.provider, account1);
      await logBalance(zkWallet.provider, account2);
    });

    it("Should transfer ETH from account 1 to account 2", async () => {
      const { provider } = argent.deployer.zkWallet;
      const transaction = {
        to: account2,
        value: ethers.utils.parseEther("0.00002668"),
      };

      const receipt = await sendEIP712Transaction(transaction, account1, provider, signer, guardian);
      console.log(`Transaction hash is ${receipt.transactionHash}`);

      await logBalance(provider, account1);
      await logBalance(provider, account2);
    });

    it("Should fail to transfer ETH from account 2 to account 1", async () => {
      const { provider } = argent.deployer.zkWallet;
      const transaction = {
        to: account1,
        value: ethers.utils.parseEther("0.00000668"),
      };

      try {
        const receipt = await sendEIP712Transaction(transaction, account2, provider, signer, guardian);
        console.log(`Transaction hash is ${receipt.transactionHash}`);
      } catch (error) {
        console.log("Transfer failed");
      }
    });
  });
});
