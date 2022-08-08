import "@nomiclabs/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import hre, { ethers } from "hardhat";
import { PopulatedTransaction } from "ethers";
import * as zksync from "zksync-web3";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { expect } from "chai";
import { ArgentArtifacts, ArgentContext, deployAccount, deployFundedAccount, logBalance } from "./account.service";
import { TransactionSender, waitForTransaction } from "./transaction.service";
import { waitForTimestamp } from "./provider.service";

const signer = new zksync.Wallet(process.env.PRIVATE_KEY as string);
const guardian = new zksync.Wallet(process.env.GUARDIAN_PRIVATE_KEY as string);
const newSigner = zksync.Wallet.createRandom();
const newGuardian = zksync.Wallet.createRandom();
const newGuardianBackup = zksync.Wallet.createRandom();
const wrongSigner = zksync.Wallet.createRandom();
const wrongGuardian = zksync.Wallet.createRandom();

const deployer = new Deployer(hre, signer);
const provider = (ethers.provider = deployer.zkWallet.provider); // needed for hardhat-ethers's .getContractAt(...)

describe("Argent account", () => {
  let artifacts: ArgentArtifacts;
  let implementation: zksync.Contract;
  let factory: zksync.Contract;
  let argent: ArgentContext;

  let noEscape: number;
  let signerEscape: number;
  let guardianEscape: number;
  let escapeSecurityPeriod: number; // in seconds

  describe("Infrastructure deployment", () => {
    before(async () => {
      artifacts = {
        implementation: await deployer.loadArtifact("ArgentAccount"),
        factory: await deployer.loadArtifact("AccountFactory"),
        proxy: await deployer.loadArtifact("Proxy"),
      };
      await logBalance(signer.address, provider, "Signer");
    });

    it("Should deploy a new ArgentAccount implementation", async () => {
      implementation = await deployer.deploy(artifacts.implementation, []);
      console.log(`        Account implementation deployed to ${implementation.address}`);

      const contract = await ethers.getContractAt("ArgentAccount", implementation.address);
      noEscape = await contract.noEscape();
      signerEscape = await contract.signerEscape();
      guardianEscape = await contract.guardianEscape();
      escapeSecurityPeriod = (await contract.escapeSecurityPeriod()).toNumber();
    });

    it("Should deploy a new AccountFactory", async () => {
      const { bytecode } = artifacts.proxy;
      const proxyBytecodeHash = zksync.utils.hashBytecode(bytecode);
      factory = await deployer.deploy(artifacts.factory, [proxyBytecodeHash], undefined, [bytecode]);
      console.log(`        Account factory deployed to ${factory.address}`);
    });

    after(() => {
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
      const accountFromEoa = new zksync.Contract(account.address, artifacts.implementation.abi, deployer.zkWallet);
      const promise = accountFromEoa.initialize(signer.address, guardian.address);
      await expect(promise).to.be.rejectedWith("argent/already-init");
    });
  });

  describe("Transfers", () => {
    let account1: zksync.Contract;
    let account2: zksync.Contract;

    it("Should deploy a new account (1)", async () => {
      account1 = await deployAccount(argent, signer.address, guardian.address);
      console.log(`        Account 1 deployed to ${account1.address}`);
    });

    it("Should deploy a new account (2)", async () => {
      account2 = await deployAccount(argent, "0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8", guardian.address);
      console.log(`        Account 2 deployed to ${account2.address}`);
    });

    it("Should fund account 1 from signer key", async () => {
      const amount = ethers.utils.parseEther("0.0001");
      const balanceBefore = await provider.getBalance(account1.address);

      const response = await deployer.zkWallet.transfer({ to: account1.address, amount });
      await response.wait();

      const balanceAfter = await provider.getBalance(account1.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(amount);
    });

    it("Should transfer ETH from account 1 to account 2", async () => {
      const amount = ethers.utils.parseEther("0.00002668");
      const balanceBefore1 = await provider.getBalance(account1.address);
      const balanceBefore2 = await provider.getBalance(account2.address);

      const transaction = { to: account2.address, value: amount };
      await waitForTransaction(transaction, [signer, guardian], account1, provider);

      const balanceAfter1 = await provider.getBalance(account1.address);
      const balanceAfter2 = await provider.getBalance(account2.address);

      expect(balanceBefore2).to.equal(0n);
      expect(balanceAfter1).to.be.lessThan(balanceBefore1.sub(amount)); // account for paid gas
      expect(balanceAfter2).to.equal(amount);
    });

    it("Should fail to transfer ETH from account 2 to account 1", async () => {
      const transaction = {
        to: account1.address,
        value: ethers.utils.parseEther("0.00000668"),
      };

      const promise = waitForTransaction(transaction, [signer, guardian], account2, provider);
      expect(promise).to.be.rejectedWith(/transaction failed|invalid hash/);
    });
  });

  describe("Using a dapp", () => {
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
        [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
      });

      it("Should revert with bad nonce", async () => {
        const transaction = { ...dappTransaction, nonce: 999 };
        const promise = sender.waitForTransaction(transaction, [signer, guardian]);
        await expect(promise).to.be.rejectedWith("Tx nonce is incorrect");
      });

      it("Should revert with bad signer", async () => {
        const promise = sender.waitForTransaction(dappTransaction, [wrongSigner, guardian]);
        await expect(promise).to.be.rejectedWith("argent/invalid-signer-signature");
      });

      it("Should revert with bad guardian", async () => {
        const promise = sender.waitForTransaction(dappTransaction, [signer, wrongGuardian]);
        await expect(promise).to.be.rejectedWith("argent/invalid-guardian-signature");
      });

      it("Should revert with just 1 signer", async () => {
        const promise = sender.waitForTransaction(dappTransaction, [signer]);
        await expect(promise).to.be.rejectedWith("argent/invalid-guardian-signature-length");
      });

      it("Should successfully call the dapp", async () => {
        expect(await dapp.userNumbers(account.address)).to.equal(0n);
        await sender.waitForTransaction(dappTransaction, [signer, guardian]);
        expect(await dapp.userNumbers(account.address)).to.equal(69n);
      });
    });

    describe("Calling the dapp without using a guardian", () => {
      let account: zksync.Contract;
      let sender: TransactionSender;

      before(async () => {
        [account, sender] = await deployFundedAccount(argent, signer.address, ethers.constants.AddressZero);
      });

      it("Should successfully call the dapp", async () => {
        expect(await dapp.userNumbers(account.address)).to.equal(0n);
        await sender.waitForTransaction(dappTransaction, [signer]);
        expect(await dapp.userNumbers(account.address)).to.equal(69n);
      });

      it("Should change the signer", async () => {
        expect(await account.callStatic.signer()).to.equal(signer.address);

        const transaction = await account.populateTransaction.changeSigner(newSigner.address);
        const { response } = await sender.waitForTransaction(transaction, [signer]);

        await expect(response).to.emit(account, "SignerChanged").withArgs(newSigner.address);
        expect(await account.callStatic.signer()).to.equal(newSigner.address);
      });

      it("Should revert calls that require the guardian to be set", async () => {
        const transaction = await account.populateTransaction.triggerEscapeGuardian();
        const promise = sender.waitForTransaction(transaction, [newSigner]);
        await expect(promise).to.be.rejectedWith("argent/guardian-required");
      });

      it("Should add a guardian", async () => {
        expect(await account.guardian()).to.equal(ethers.constants.AddressZero);

        const transaction = await account.populateTransaction.changeGuardian(guardian.address);
        const { response } = await sender.waitForTransaction(transaction, [newSigner]);

        await expect(response).to.emit(account, "GuardianChanged").withArgs(guardian.address);
        expect(await account.guardian()).to.equal(guardian.address);
      });
    });
  });

  describe("Recovery", () => {
    describe("Changing signer", () => {
      let account: zksync.Contract;
      let sender: TransactionSender;
      let transaction: PopulatedTransaction;

      before(async () => {
        [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
        transaction = await account.populateTransaction.changeSigner(newSigner.address);
      });

      it("Should revert with the wrong signer signature", async () => {
        const promise = sender.sendTransaction(transaction, [wrongSigner, guardian]);
        await expect(promise).to.be.rejectedWith("argent/invalid-signer-signature");
      });

      it("Should revert with the wrong guardian signature", async () => {
        const promise = sender.sendTransaction(transaction, [signer, wrongGuardian]);
        await expect(promise).to.be.rejectedWith("argent/invalid-guardian-signature");
      });

      it("Should work with the correct signatures", async () => {
        expect(await account.callStatic.signer()).to.equal(signer.address);

        const { response } = await sender.waitForTransaction(transaction, [signer, guardian]);

        await expect(response).to.emit(account, "SignerChanged").withArgs(newSigner.address);
        expect(await account.callStatic.signer()).to.equal(newSigner.address);
      });
    });

    describe("Changing guardian", () => {
      let account: zksync.Contract;
      let sender: TransactionSender;
      let transaction: PopulatedTransaction;

      before(async () => {
        [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
        transaction = await account.populateTransaction.changeGuardian(newGuardian.address);
      });

      it("Should revert with the wrong signer signature", async () => {
        const promise = sender.sendTransaction(transaction, [wrongSigner, guardian]);
        await expect(promise).to.be.rejectedWith("argent/invalid-signer-signature");
      });

      it("Should revert with the wrong guardian signature", async () => {
        const promise = sender.sendTransaction(transaction, [signer, wrongGuardian]);
        await expect(promise).to.be.rejectedWith("argent/invalid-guardian-signature");
      });

      it("Should work with the correct signatures", async () => {
        expect(await account.guardian()).to.equal(guardian.address);

        const { response } = await sender.waitForTransaction(transaction, [signer, guardian]);

        await expect(response).to.emit(account, "GuardianChanged").withArgs(newGuardian.address);
        expect(await account.guardian()).to.equal(newGuardian.address);
      });
    });

    describe("Changing guardian backup", () => {
      let account: zksync.Contract;
      let sender: TransactionSender;
      let transaction: PopulatedTransaction;

      before(async () => {
        [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
        transaction = await account.populateTransaction.changeGuardianBackup(newGuardianBackup.address);
      });

      it("Should revert with the wrong signer signature", async () => {
        const promise = sender.sendTransaction(transaction, [wrongSigner, guardian]);
        await expect(promise).to.be.rejectedWith("argent/invalid-signer-signature");
      });

      it("Should revert with the wrong guardian signature", async () => {
        const promise = sender.sendTransaction(transaction, [signer, wrongGuardian]);
        await expect(promise).to.be.rejectedWith("argent/invalid-guardian-signature");
      });

      it("Should work with the correct signatures", async () => {
        expect(await account.guardianBackup()).to.equal(ethers.constants.AddressZero);

        const { response } = await sender.waitForTransaction(transaction, [signer, guardian]);

        await expect(response).to.emit(account, "GuardianBackupChanged").withArgs(newGuardianBackup.address);
        expect(await account.guardianBackup()).to.equal(newGuardianBackup.address);
      });

      it("Should fail when no guardian", async () => {
        const [account, sender] = await deployFundedAccount(argent, signer.address, ethers.constants.AddressZero);
        const transaction = await account.populateTransaction.changeGuardianBackup(newGuardianBackup.address);

        const promise = sender.waitForTransaction(transaction, [signer]);
        await expect(promise).to.be.rejectedWith("argent/guardian-required");
      });
    });

    describe("Escape triggering", () => {
      it("Should run triggerEscapeGuardian() by signer", async () => {
        const [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
        const transaction = await account.populateTransaction.triggerEscapeGuardian();

        const escapeBefore = await account.escape();
        expect(escapeBefore.activeAt).to.equal(0n);
        expect(escapeBefore.escapeType).to.equal(noEscape);

        const { response, receipt } = await sender.waitForTransaction(transaction, [signer]);
        const { timestamp } = await provider.getBlock(receipt.blockHash);
        const activeAtExpected = timestamp + escapeSecurityPeriod;
        await expect(response).to.emit(account, "EscapeGuardianTriggerred").withArgs(activeAtExpected);

        const escapeAfter = await account.escape();
        expect(escapeAfter.activeAt).to.equal(activeAtExpected);
        expect(escapeAfter.escapeType).to.equal(guardianEscape);
      });

      it("Should run triggerEscapeSigner() by guardian", async () => {
        const [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
        const transaction = await account.populateTransaction.triggerEscapeSigner();

        const escapeBefore = await account.escape();
        expect(escapeBefore.activeAt).to.equal(0n);
        expect(escapeBefore.escapeType).to.equal(noEscape);

        const { response, receipt } = await sender.waitForTransaction(transaction, [guardian]);
        const { timestamp } = await provider.getBlock(receipt.blockHash);
        const activeAtExpected = timestamp + escapeSecurityPeriod;
        await expect(response).to.emit(account, "EscapeSignerTriggerred").withArgs(activeAtExpected);

        const escapeAfter = await account.escape();
        expect(escapeAfter.activeAt).to.equal(activeAtExpected);
        expect(escapeAfter.escapeType).to.equal(signerEscape);
      });

      it("Should run triggerEscapeSigner() by guardian backup", async () => {
        const [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
        const backupTransaction = await account.populateTransaction.changeGuardianBackup(newGuardianBackup.address);
        await sender.waitForTransaction(backupTransaction, [signer, guardian]);

        const escapeBefore = await account.escape();
        expect(escapeBefore.activeAt).to.equal(0n);
        expect(escapeBefore.escapeType).to.equal(noEscape);

        const transaction = await account.populateTransaction.triggerEscapeSigner();
        const { response, receipt } = await sender.waitForTransaction(transaction, [0, newGuardianBackup]);
        const { timestamp } = await provider.getBlock(receipt.blockHash);
        const activeAtExpected = timestamp + escapeSecurityPeriod;
        await expect(response).to.emit(account, "EscapeSignerTriggerred").withArgs(activeAtExpected);

        const escapeAfter = await account.escape();
        expect(escapeAfter.activeAt).to.equal(activeAtExpected);
        expect(escapeAfter.escapeType).to.equal(signerEscape);
      });
    });

    describe("Escaping", () => {
      if (escapeSecurityPeriod > 60) {
        throw new Error("These tests require an escape security period of less than 60 seconds");
      }

      it("Should escape guardian", async () => {
        const [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
        const triggerTransaction = await account.populateTransaction.triggerEscapeGuardian();
        const escapeTransaction = await account.populateTransaction.escapeGuardian(newGuardian.address);

        // trigger escape
        const { response: triggerResponse } = await sender.waitForTransaction(triggerTransaction, [signer]);
        await expect(triggerResponse).to.emit(account, "EscapeGuardianTriggerred");

        const escape = await account.escape();
        expect(escape.activeAt).to.be.greaterThan(0n);
        expect(escape.escapeType).to.equal(guardianEscape);

        // should fail to escape before the end of the period
        const promise = sender.waitForTransaction(escapeTransaction, [signer]);
        await expect(promise).to.be.rejectedWith("argent/inactive-escape");

        // wait security period
        await waitForTimestamp(escape.activeAt.toNumber(), provider);

        expect(await account.guardian()).to.equal(guardian.address);

        // should escape after the security period
        const { response: escapeResponse } = await sender.waitForTransaction(escapeTransaction, [signer]);
        await expect(escapeResponse).to.emit(account, "GuardianEscaped").withArgs(newGuardian.address);

        expect(await account.guardian()).to.equal(newGuardian.address);

        // escape should be cleared
        const postEscape = await account.escape();
        expect(postEscape.activeAt).to.equal(0n);
        expect(postEscape.escapeType).to.equal(noEscape);
      });

      it("Should escape signer", async () => {
        const [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
        const triggerTransaction = await account.populateTransaction.triggerEscapeSigner();
        const escapeTransaction = await account.populateTransaction.escapeSigner(newSigner.address);

        // trigger escape
        const { response: triggerResponse } = await sender.waitForTransaction(triggerTransaction, [guardian]);
        await expect(triggerResponse).to.emit(account, "EscapeSignerTriggerred");

        const escape = await account.escape();
        expect(escape.activeAt).to.be.greaterThan(0n);
        expect(escape.escapeType).to.equal(signerEscape);

        // should fail to escape before the end of the period
        const promise = sender.waitForTransaction(escapeTransaction, [guardian]);
        await expect(promise).to.be.rejectedWith("argent/inactive-escape");

        // wait security period
        await waitForTimestamp(escape.activeAt.toNumber(), provider);

        expect(await account.callStatic.signer()).to.equal(signer.address);

        // should escape after the security period
        const { response: escapeResponse } = await sender.waitForTransaction(escapeTransaction, [guardian]);
        await expect(escapeResponse).to.emit(account, "SignerEscaped").withArgs(newSigner.address);

        expect(await account.callStatic.signer()).to.equal(newSigner.address);

        // escape should be cleared
        const postEscape = await account.escape();
        expect(postEscape.activeAt).to.equal(0n);
        expect(postEscape.escapeType).to.equal(noEscape);
      });
    });

    describe("Escape overriding", () => {
      it("Should allow signer to override a signer escape", async () => {
        const [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
        const guardianTransaction = await account.populateTransaction.triggerEscapeSigner();
        const signerTransaction = await account.populateTransaction.triggerEscapeGuardian();

        // guardian triggers a signer escape
        await sender.waitForTransaction(guardianTransaction, [guardian]);

        const firstEscape = await account.escape();
        expect(firstEscape.activeAt).to.be.greaterThan(0n);
        expect(firstEscape.escapeType).to.equal(signerEscape);

        // TODO: do evm_increaseTime + evm_mine here when testing locally

        // signer overrides the guardian's escape
        await sender.waitForTransaction(signerTransaction, [signer]);

        const secondEscape = await account.escape();
        expect(secondEscape.activeAt).to.be.greaterThan(firstEscape.activeAt);
        expect(secondEscape.escapeType).to.equal(guardianEscape);
      });

      it("Should forbid guardian to override a guardian escape", async () => {
        const [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
        const guardianTransaction = await account.populateTransaction.triggerEscapeSigner();
        const signerTransaction = await account.populateTransaction.triggerEscapeGuardian();

        // signer triggers a guardian escape
        await sender.waitForTransaction(signerTransaction, [signer]);

        const escape = await account.escape();
        expect(escape.activeAt).to.be.greaterThan(0n);
        expect(escape.escapeType).to.equal(guardianEscape);

        // TODO: do evm_increaseTime + evm_mine here when testing locally

        // guardian cannot override
        const promise = sender.waitForTransaction(guardianTransaction, [guardian]);
        await expect(promise).to.be.rejectedWith("argent/cannot-override-signer-escape");

        const secondEscape = await account.escape();
        expect(secondEscape.activeAt).to.equal(escape.activeAt);
        expect(secondEscape.escapeType).to.equal(guardianEscape);
      });
    });

    it("Should cancel an escape", async () => {
      const [account, sender] = await deployFundedAccount(argent, signer.address, guardian.address);
      const triggerTransaction = await account.populateTransaction.triggerEscapeSigner();
      const cancelTransaction = await account.populateTransaction.cancelEscape();

      // guardian triggers a signer escape
      await sender.waitForTransaction(triggerTransaction, [guardian]);

      const escape = await account.escape();
      expect(escape.activeAt).to.be.greaterThan(0n);
      expect(escape.escapeType).to.equal(signerEscape);

      // should fail to cancel with just the signer signature
      const promise = sender.waitForTransaction(cancelTransaction, [signer]);
      await expect(promise).to.be.rejectedWith("argent/invalid-guardian-signature");

      const { response } = await sender.waitForTransaction(cancelTransaction, [signer, guardian]);
      await expect(response).to.emit(account, "EscapeCancelled");

      const secondEscape = await account.escape();
      expect(secondEscape.activeAt).to.equal(0n);
      expect(secondEscape.escapeType).to.equal(noEscape);
    });
  });

  describe("EIP-1271 signature verification of EIP-712 typed messages", () => {
    const domain = {
      name: "Ether Mail",
      version: "1",
      chainId: 1,
      verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    };

    const types = {
      Person: [
        { name: "name", type: "string" },
        { name: "wallet", type: "address" },
      ],
      Mail: [
        { name: "from", type: "Person" },
        { name: "to", type: "Person" },
        { name: "contents", type: "string" },
      ],
    };

    const value = {
      from: { name: "Cow", wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826" },
      to: { name: "Bob", wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" },
      contents: "Hello, Bob!",
    };

    const hash = ethers.utils._TypedDataEncoder.hash(domain, types, value);
    const eip1271SuccessReturnValue = "0x1626ba7e";
    const signWith = (signatory: zksync.Wallet) => signatory._signTypedData(domain, types, value);

    let account: zksync.Contract;

    before(async () => {
      account = await deployAccount(argent, signer.address, guardian.address);
    });

    it("Should verify on the account", async () => {
      const signature = ethers.utils.concat([await signWith(signer), await signWith(guardian)]);
      expect(await account.isValidSignature(hash, signature)).to.equal(eip1271SuccessReturnValue);
    });

    it("Should verify with a single signature when not using a guardian", async () => {
      const accountNoGuardian = await deployAccount(argent, signer.address, ethers.constants.AddressZero);
      const signature = await signWith(signer);
      expect(await accountNoGuardian.isValidSignature(hash, signature)).to.equal(eip1271SuccessReturnValue);
    });

    it("Should fail to verify using incorrect signers", async () => {
      let signature = ethers.utils.concat([await signWith(signer), await signWith(wrongGuardian)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = ethers.utils.concat([await signWith(signer), await signWith(signer)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = ethers.utils.concat([await signWith(guardian), await signWith(guardian)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;
    });

    it("Should fail to verify using zeros in any position", async () => {
      let signature = ethers.utils.concat([new Uint8Array(65), await signWith(guardian)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = ethers.utils.concat([await signWith(signer), new Uint8Array(65)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = new Uint8Array(130);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;
    });
  });
});
