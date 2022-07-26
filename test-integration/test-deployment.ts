import hre, { ethers } from "hardhat";
import { PopulatedTransaction } from "ethers";
import * as zksync from "zksync-web3";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { expect } from "chai";
import { ArgentArtifacts, ArgentContext, deployAccount, logBalance, sendArgentTransaction } from "./accounts.service";

describe("Argent account", () => {
  const signer = new zksync.Wallet(process.env.PRIVATE_KEY as string);
  const guardian = new zksync.Wallet(process.env.GUARDIAN_PRIVATE_KEY as string);

  let argent: ArgentContext;

  describe("Infrastructure deployment", () => {
    let deployer: Deployer;
    let provider: zksync.Provider;
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
      provider = ethers.provider = deployer.zkWallet.provider; // needed for .getContractAt(...) in hardhat-ethers
      const balance = await provider.getBalance(signer.address);
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

      const receipt = await sendArgentTransaction(transaction, account1.address, argent.provider, [signer, guardian]);
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
        const receipt = await sendArgentTransaction(transaction, account2.address, argent.provider, [signer, guardian]);
        console.log(`Transaction hash is ${receipt.transactionHash}`);
      } catch (error) {
        console.log("Transfer failed");
      }
    });
  });

  describe("Recovery", () => {
    const wrongSigner = zksync.Wallet.createRandom();
    const wrongGuardian = zksync.Wallet.createRandom();

    let account: zksync.Contract;
    let dapp: zksync.Contract;
    let dappTransaction: PopulatedTransaction;

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
      dappTransaction = await dapp.populateTransaction.setNumber(69);
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
    });

    it("Dapp with an EOA should work", async () => {
      expect(await dapp.userNumbers(signer.address)).to.equal(0n);
      const response = await dapp.setNumber(42);
      await response.wait();
      expect(await dapp.userNumbers(signer.address)).to.equal(42n);
    });

    describe("Dapp with guardian", () => {
      it("should should successfully call the dapp", async () => {
        expect(await dapp.userNumbers(account.address)).to.equal(0n);
        await sendArgentTransaction(dappTransaction, account, argent.provider, [signer, guardian]);
        expect(await dapp.userNumbers(account.address)).to.equal(69n);
      });

      it("should revert with bad nonce", async () => {
        const transaction = { ...dappTransaction, nonce: 999 };
        expectRejection("Tx nonce is incorrect", () =>
          sendArgentTransaction(transaction, account, argent.provider, [signer, guardian])
        );
      });

      it("should revert with bad signer", async () => {
        expectRejection("argent/invalid-signer-signature", () =>
          sendArgentTransaction(dappTransaction, account, argent.provider, [wrongSigner, guardian]),
        );
      });

      it("should revert with bad guardian", async () => {
        expectRejection("argent/invalid-guardian-signature", () =>
          sendArgentTransaction(dappTransaction, account, argent.provider, [signer, wrongGuardian]),
        );
      });

      it("should revert with only 1 signer", async () => {
        expectRejection("argent/invalid-signature-length", () =>
          sendArgentTransaction(dappTransaction, account, argent.provider, [signer]),
        );
      });
    });
  });
});

// TODO: check why below not working?
// await expect(promise).to.be.revertedWith("reason");
const expectRejection = async (errorMessage: string, promise: Promise<unknown> | (() => Promise<unknown>)) => {
  let message = "";
  try {
    if (typeof promise === "function") {
      promise = promise();
    }
    await promise;
  } catch (error) {
    message = `${error}`;
  }
  expect(message).to.include(errorMessage);
};
