import hre, { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { expect } from "chai";
import { ArgentArtifacts, ArgentContext, deployAccount, logBalance, sendArgentTransaction } from "./accounts.service";

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
      ethers.provider = deployer.zkWallet.provider; // needed for .getContractAt(...) in hardhat-ethers 
      const balance = await deployer.zkWallet.provider.getBalance(signer.address);
      console.log(`Signer ETH L2 balance is ${ethers.utils.formatEther(balance)}`);
    });

    it("Should deploy a new ArgentAccount implementation", async () => {
      implementation = await deployer.deploy(artifacts.implementation, []);
      console.log(`Account implementation deployed to ${implementation.address}`);
    });

    it("Should deploy a new AccountFactory", async () => {
      const { bytecode } = artifacts.proxy;
      const proxyBytecodeHash = zksync.utils.hashBytecode(bytecode);
      factory = await deployer.deploy(artifacts.factory, [proxyBytecodeHash], undefined, [bytecode]);
      console.log(`Account factory deployed to ${factory.address}`);
    });

    after(async () => {
      const { provider } = deployer.zkWallet;
      argent = { deployer, provider, artifacts, implementation, factory };
    });
  });

  describe("Transfers", () => {
    let account1: zksync.Contract;
    let account2: zksync.Contract;

    it("Should deploy a new account (1)", async () => {
      account1 = await deployAccount(argent, signer.address, guardian.address);
      console.log(`Account 1 deployed to ${account1.address}`);
    });

    it("Should deploy a new account (2)", async () => {
      account2 = await deployAccount(argent, "0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8", guardian.address);
      console.log(`Account 2 deployed to ${account2.address}`);
    });

    it("Should fund account 1 from signer key", async () => {
      const { zkWallet } = argent.deployer;
      const response = await zkWallet.transfer({
        to: account1.address,
        amount: ethers.utils.parseEther("0.0001"),
      });
      await response.wait();

      await logBalance(zkWallet.provider, account1.address);
      await logBalance(zkWallet.provider, account2.address);
    });

    it("Should transfer ETH from account 1 to account 2", async () => {
      const transaction = {
        to: account2.address,
        value: ethers.utils.parseEther("0.00002668"),
      };

      const receipt = await sendArgentTransaction(transaction, account1.address, argent.provider, signer, guardian);
      console.log(`Transaction hash is ${receipt.transactionHash}`);

      await logBalance(argent.provider, account1.address);
      await logBalance(argent.provider, account2.address);
    });

    it("Should fail to transfer ETH from account 2 to account 1", async () => {
      const transaction = {
        to: account1.address,
        value: ethers.utils.parseEther("0.00000668"),
      };

      try {
        const receipt = await sendArgentTransaction(transaction, account2.address, argent.provider, signer, guardian);
        console.log(`Transaction hash is ${receipt.transactionHash}`);
      } catch (error) {
        console.log("Transfer failed");
      }
    });
  });

  describe("Recovery", () => {
    let account: zksync.Contract;
    let dapp: zksync.Contract;

    before(async () => {
      account = await deployAccount(argent, signer.address, guardian.address, ethers.utils.zeroPad([1], 32));
      const { zkWallet } = argent.deployer;
      const response = await zkWallet.transfer({
        to: account.address,
        amount: ethers.utils.parseEther("0.0001"),
      });
      await response.wait();
      await logBalance(zkWallet.provider, account.address);

      const dappArtifact = await argent.deployer.loadArtifact("TestDapp");
      dapp = await argent.deployer.deploy(dappArtifact);
    });

    it("Dapp should work with an EOA", async () => {
      expect(await dapp.userNumbers(signer.address)).to.equal(0n);
      const response = await dapp.setNumber(42);
      await response.wait();
      expect(await dapp.userNumbers(signer.address)).to.equal(42n);
    });

    it("Dapp should work with the Argent account", async () => {
      expect(await dapp.userNumbers(account.address)).to.equal(0n);
      const transaction = await dapp.populateTransaction.setNumber(69);
      await sendArgentTransaction(transaction, account.address, argent.provider, signer, guardian);
      expect(await dapp.userNumbers(account.address)).to.equal(69n);
    });

    it("Should be initialized properly", async () => {
      expect(await account.version()).to.equal("0.0.1");
      expect(await account.callStatic.signer()).to.equal(signer.address);
      expect(await account.guardian()).to.equal(guardian.address);
    });

    it("Should refuse to be initialized twice", async () => {
      const eoaAccount = new zksync.Contract(
        account.address,
        argent.artifacts.implementation.abi,
        argent.deployer.zkWallet,
      );
      expectRejection("argent/already-init", async () => {
        const response = await eoaAccount.initialize(signer.address, guardian.address);
        response.wait();
      });
      // below not working?
      // await expect(eoaAccount.initialize(signer.address, guardian.address)).to.be.revertedWith("argent/already-init");
    });
  });
});

const expectRejection = async (errorMessage: string, promise: () => Promise<unknown>) => {
  let message = "";
  try {
    await promise();
  } catch (error) {
    message = `${error}`;
  }
  expect(message).to.include(errorMessage);
}
