import hre, { ethers } from "hardhat";
import { PopulatedTransaction } from "ethers";
import * as zksync from "zksync-web3";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { expect } from "chai";
import { ArgentArtifacts, ArgentContext, deployAccount, deployFundedAccount, logBalance } from "./account.service";
import { makeTransactionSender, sendTransaction, TransactionSender, waitForTransaction } from "./transaction.service";

describe("Argent account", () => {
  const signer = new zksync.Wallet(process.env.PRIVATE_KEY as string);
  const guardian = new zksync.Wallet(process.env.GUARDIAN_PRIVATE_KEY as string);
  const deployer = new Deployer(hre, signer);
  const provider = (ethers.provider = deployer.zkWallet.provider); // needed for hardhat-ethers's .getContractAt(...)

  let artifacts: ArgentArtifacts;
  let implementation: zksync.Contract;
  let factory: zksync.Contract;
  let argent: ArgentContext;

  describe("Infrastructure deployment", () => {
    before(async () => {
      artifacts = {
        implementation: await deployer.loadArtifact("ArgentAccount"),
        factory: await deployer.loadArtifact("AccountFactory"),
        proxy: await deployer.loadArtifact("Proxy"),
      };
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
      argent = { deployer, artifacts, implementation, factory };
    });
  });

  describe("Account deployment", () => {
    let account: zksync.Contract;

    before(async () => {
      account = await deployAccount(argent, signer.address, guardian.address);
    });

    it("Should be initialized properly", async () => {
      expect(await account.version()).to.equal("0.0.1");
      expect(await account.callStatic.signer()).to.equal(signer.address);
      expect(await account.guardian()).to.equal(guardian.address);
    });

    it("Should refuse to be initialized twice", async () => {
      const eoaAccount = new zksync.Contract(account.address, artifacts.implementation.abi, deployer.zkWallet);
      expectRejection("argent/already-init", async () => {
        const response = await eoaAccount.initialize(signer.address, guardian.address);
        response.wait();
      });
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
      const response = await deployer.zkWallet.transfer({
        to: account1.address,
        amount: ethers.utils.parseEther("0.0001"),
      });
      await response.wait();

      await logBalance(provider, account1.address);
      await logBalance(provider, account2.address);
    });

    it("Should transfer ETH from account 1 to account 2", async () => {
      const transaction = {
        to: account2.address,
        value: ethers.utils.parseEther("0.00002668"),
      };

      const { receipt } = await waitForTransaction(transaction, account1.address, provider, [signer, guardian]);
      console.log(`Transaction hash is ${receipt.transactionHash}`);

      await logBalance(provider, account1.address);
      await logBalance(provider, account2.address);
    });

    it("Should fail to transfer ETH from account 2 to account 1", async () => {
      const transaction = {
        to: account1.address,
        value: ethers.utils.parseEther("0.00000668"),
      };

      try {
        const { receipt } = await waitForTransaction(transaction, account2.address, provider, [signer, guardian]);
        console.log(`Transaction hash is ${receipt.transactionHash}`);
      } catch (error) {
        console.log("Transfer failed");
      }
    });
  });

  describe("Using a dapp", () => {
    const wrongSigner = zksync.Wallet.createRandom();
    const wrongGuardian = zksync.Wallet.createRandom();

    let dapp: zksync.Contract;
    let dappTransaction: PopulatedTransaction;

    before(async () => {
      const dappArtifact = await deployer.loadArtifact("TestDapp");
      dapp = await deployer.deploy(dappArtifact);
      dappTransaction = await dapp.populateTransaction.setNumber(69);
    });

    it("Should call the dapp from an EOA", async () => {
      expect(await dapp.userNumbers(signer.address)).to.equal(0n);
      const response = await dapp.setNumber(42);
      await response.wait();
      expect(await dapp.userNumbers(signer.address)).to.equal(42n);
    });

    describe("Calling the dapp using a guardian", () => {
      let account: zksync.Contract;
      let sender: TransactionSender;

      before(async () => {
        account = await deployFundedAccount(argent, signer.address, guardian.address);
        sender = makeTransactionSender(account, provider);
      });

      it("should should successfully call the dapp", async () => {
        expect(await dapp.userNumbers(account.address)).to.equal(0n);
        await sender.waitForTransaction(dappTransaction, [signer, guardian]);
        expect(await dapp.userNumbers(account.address)).to.equal(69n);
      });

      it("should revert with bad nonce", async () => {
        const transaction = { ...dappTransaction, nonce: 999 };
        expectRejection("Tx nonce is incorrect", sender.waitForTransaction(transaction, [signer, guardian]));
      });

      it("should revert with bad signer", async () => {
        expectRejection("argent/invalid-signer-signature", () =>
          sender.waitForTransaction(dappTransaction, [wrongSigner, guardian]),
        );
      });

      it("should revert with bad guardian", async () => {
        expectRejection("argent/invalid-guardian-signature", () =>
          sender.waitForTransaction(dappTransaction, [signer, wrongGuardian]),
        );
      });

      it("should revert with only 1 signer", async () => {
        expectRejection("argent/invalid-signature-length", () => sender.waitForTransaction(dappTransaction, [signer]));
      });
    });

    describe("Calling the dapp without using a guardian", () => {
      const newSigner = zksync.Wallet.createRandom();

      let account: zksync.Contract;
      let sender: TransactionSender;

      before(async () => {
        account = await deployFundedAccount(argent, signer.address, ethers.constants.AddressZero);
        sender = makeTransactionSender(account, provider);
      });

      it("should should successfully call the dapp", async () => {
        expect(await dapp.userNumbers(account.address)).to.equal(0n);
        await sender.waitForTransaction(dappTransaction, [signer, guardian]);
        expect(await dapp.userNumbers(account.address)).to.equal(69n);
      });

      it("should change the signer", async () => {
        expect(await account.callStatic.signer()).to.equal(signer.address);

        const transaction = await account.populateTransaction.changeSigner(newSigner.address);
        const { response } = await sender.waitForTransaction(transaction, [signer, 0]);

        await expect(response).to.emit(account, "SignerChanged").withArgs(newSigner.address);
        expect(await account.callStatic.signer()).to.equal(newSigner.address);
      });

      it("should revert calls that require the guardian to be set", async () => {
        const transaction = await account.populateTransaction.triggerEscapeGuardian();
        const response = sender.sendTransaction(transaction, [newSigner, 0]);
        await expect(response).to.be.reverted; // TODO: check why error reason doesn't bubble up
      });

      it("should add a guardian", async () => {
        expect(await account.guardian()).to.equal(ethers.constants.AddressZero);

        const transaction = await account.populateTransaction.changeGuardian(guardian.address);
        const { response } = await sender.waitForTransaction(transaction, [newSigner, 0]);
        await expect(response).to.emit(account, "GuardianChanged").withArgs(guardian.address);

        expect(await account.guardian()).to.equal(guardian.address);
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
