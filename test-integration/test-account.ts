import "@nomiclabs/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import hre, { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { expect } from "chai";
import { ArgentAccount, ArgentArtifacts, ArgentContext, deployAccount, logBalance } from "../scripts/account.service";
import { waitForTimestamp } from "../scripts/provider.service";

const { AddressZero } = ethers.constants;

const owner = zksync.Wallet.createRandom();
const guardian = zksync.Wallet.createRandom();
const newOwner = zksync.Wallet.createRandom();
const newGuardian = zksync.Wallet.createRandom();
const newGuardianBackup = zksync.Wallet.createRandom();
const wrongOwner = zksync.Wallet.createRandom();
const wrongGuardian = zksync.Wallet.createRandom();

const ownerAddress = owner.address;
const guardianAddress = guardian.address;
const deployer = new Deployer(hre, new zksync.Wallet(process.env.PRIVATE_KEY as string));
const { provider } = deployer.zkWallet;

describe("Argent account", () => {
  let artifacts: ArgentArtifacts;
  let implementation: zksync.Contract;
  let factory: zksync.Contract;
  let argent: ArgentContext;

  let noEscape: number;
  let ownerEscape: number;
  let guardianEscape: number;
  let escapeSecurityPeriod: number; // in seconds

  describe("Infrastructure deployment", () => {
    before(async () => {
      artifacts = {
        implementation: await deployer.loadArtifact("ArgentAccount"),
        factory: await deployer.loadArtifact("AccountFactory"),
        proxy: await deployer.loadArtifact("Proxy"),
      };
      await logBalance(deployer.zkWallet.address, provider, "Deployer");
    });

    it("Should deploy a new ArgentAccount implementation", async () => {
      implementation = await deployer.deploy(artifacts.implementation, []);
      console.log(`        Account implementation deployed to ${implementation.address}`);

      const account = new ArgentAccount(implementation.address, implementation.interface, provider);
      noEscape = await account.noEscape();
      ownerEscape = await account.ownerEscape();
      guardianEscape = await account.guardianEscape();
      escapeSecurityPeriod = await account.escapeSecurityPeriod();
    });

    it("Should deploy a new AccountFactory", async () => {
      const { bytecode } = artifacts.proxy;
      const proxyBytecodeHash = zksync.utils.hashBytecode(bytecode);
      factory = await deployer.deploy(artifacts.factory, [proxyBytecodeHash], undefined, [bytecode]);
      console.log(`        Account factory deployed to ${factory.address}`);
    });

    after(() => {
      if (!implementation || !factory) {
        console.error("Failed to deploy testing environment.");
        throw new Error("Failed to deploy testing environment.");
      }
      argent = { deployer, artifacts, implementation, factory };
    });
  });

  describe("Account deployment", () => {
    let account: ArgentAccount;

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
    });

    it("Should be initialized properly", async () => {
      expect(await account.version()).to.equal("0.0.1");
      expect(await account.owner()).to.equal(owner.address);
      expect(await account.guardian()).to.equal(guardian.address);
    });

    it("Should refuse to be initialized twice", async () => {
      const accountFromEoa = new zksync.Contract(account.address, artifacts.implementation.abi, deployer.zkWallet);
      const promise = accountFromEoa.initialize(owner.address, guardian.address);
      await expect(promise).to.be.rejectedWith("argent/already-init");
    });
  });

  describe("Transfers", () => {
    let account1: ArgentAccount;
    let account2: ArgentAccount;

    it("Should deploy a new account (1)", async () => {
      const connect = [owner, guardian];
      account1 = await deployAccount({ argent, ownerAddress, guardianAddress, connect, funds: false });
      console.log(`        Account 1 deployed to ${account1.address}`);
    });

    it("Should deploy a new account (2)", async () => {
      const ownerAddress = "0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8";
      account2 = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
      console.log(`        Account 2 deployed to ${account2.address}`);
    });

    it("Should fund account 1 from owner key", async () => {
      const balanceBefore = await provider.getBalance(account1.address);

      const amount = ethers.utils.parseEther("0.0001");
      const response = await deployer.zkWallet.transfer({ to: account1.address, amount });
      await response.wait();

      const balanceAfter = await provider.getBalance(account1.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(amount);
    });

    it("Should transfer ETH from account 1 to account 2", async () => {
      const amount = ethers.utils.parseEther("0.00002668");
      const balanceBefore1 = await provider.getBalance(account1.address);
      const balanceBefore2 = await provider.getBalance(account2.address);

      const response = await account1.signer.sendTransaction({ to: account2.address, value: amount });
      await response.wait();

      const balanceAfter1 = await provider.getBalance(account1.address);
      const balanceAfter2 = await provider.getBalance(account2.address);

      expect(balanceBefore2).to.equal(0n);
      expect(balanceAfter1).to.be.lessThan(balanceBefore1.sub(amount)); // account for paid gas
      expect(balanceAfter2).to.equal(amount);
    });

    it("Should fail to transfer ETH from account 2 to account 1", async () => {
      const promise = account2.connect([owner, guardian]).signer.sendTransaction({
        to: account1.address,
        value: ethers.utils.parseEther("0.00000668"),
      });

      expect(promise).to.be.rejectedWith(/transaction failed|invalid hash/);
    });
  });

  describe("Using a dapp", () => {
    let account: ArgentAccount;
    let testDapp: zksync.Contract;

    before(async () => {
      const dappArtifact = await deployer.loadArtifact("TestDapp");
      testDapp = await deployer.deploy(dappArtifact);
    });

    it("Should call the dapp from an EOA", async () => {
      expect(await testDapp.userNumbers(deployer.zkWallet.address)).to.equal(0n);

      const response = await testDapp.setNumber(42);
      await response.wait();

      expect(await testDapp.userNumbers(deployer.zkWallet.address)).to.equal(42n);
    });

    describe("Calling the dapp using a guardian", () => {
      before(async () => {
        account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner, guardian] });
      });

      it("Should revert with bad nonce", async () => {
        const dapp = testDapp.connect(account.signer);
        await expect(dapp.setNumber(69, { nonce: 999 })).to.be.rejectedWith("Tx nonce is incorrect");
      });

      it("Should revert with bad owner", async () => {
        const dapp = testDapp.connect(account.connect([wrongGuardian, guardian]).signer);
        await expect(dapp.setNumber(69)).to.be.rejectedWith("argent/invalid-owner-signature");
      });

      it("Should revert with bad guardian", async () => {
        const dapp = testDapp.connect(account.connect([owner, wrongGuardian]).signer);
        await expect(dapp.setNumber(69)).to.be.rejectedWith("argent/invalid-guardian-signature");
      });

      it("Should revert with just 1 owner", async () => {
        const dapp = testDapp.connect(account.connect([owner]).signer);
        await expect(dapp.setNumber(69)).to.be.rejectedWith("argent/invalid-guardian-signature-length");
      });

      it("Should successfully call the dapp", async () => {
        const dapp = testDapp.connect(account.signer);
        expect(await dapp.userNumbers(account.address)).to.equal(0n);

        const response = await dapp.setNumber(69);
        await response.wait();

        expect(await dapp.userNumbers(account.address)).to.equal(69n);
      });
    });

    describe("Calling the dapp without using a guardian", () => {
      before(async () => {
        account = await deployAccount({
          argent,
          ownerAddress,
          guardianAddress: AddressZero,
          connect: [owner],
          funds: "0.00015",
        });
      });

      it("Should successfully call the dapp", async () => {
        expect(await testDapp.userNumbers(account.address)).to.equal(0n);

        const response = await testDapp.connect(account.signer).setNumber(69);
        await response.wait();

        expect(await testDapp.userNumbers(account.address)).to.equal(69n);
      });

      it("Should change the owner", async () => {
        expect(await account.owner()).to.equal(owner.address);

        const promise = account.changeOwner(newOwner.address);

        await expect(promise)
          .to.emit(account, "OwnerChanged")
          .withArgs(newOwner.address);
        expect(await account.owner()).to.equal(newOwner.address);
      });

      it("Should revert calls that require the guardian to be set", async () => {
        account = account.connect([newOwner]);
        await expect(account.triggerEscapeGuardian()).to.be.rejectedWith("argent/guardian-required");
      });

      it("Should add a guardian", async () => {
        expect(await account.guardian()).to.equal(AddressZero);

        const promise = account.changeGuardian(guardian.address);

        await expect(promise)
          .to.emit(account, "GuardianChanged")
          .withArgs(guardian.address);
        expect(await account.guardian()).to.equal(guardian.address);
      });
    });
  });

  describe("Recovery", () => {
    let account: ArgentAccount;

    describe("Changing owner", () => {
      before(async () => {
        account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner, guardian] });
      });

      it("Should revert with the wrong owner signature", async () => {
        const promise = account.connect([wrongOwner, guardian]).changeOwner(newOwner.address);
        await expect(promise).to.be.rejectedWith("argent/invalid-owner-signature");
      });

      it("Should revert with the wrong guardian signature", async () => {
        const promise = account.connect([owner, wrongGuardian]).changeOwner(newOwner.address);
        await expect(promise).to.be.rejectedWith("argent/invalid-guardian-signature");
      });

      it("Should work with the correct signatures", async () => {
        expect(await account.owner()).to.equal(owner.address);

        const promise = account.changeOwner(newOwner.address);

        await expect(promise)
          .to.emit(account, "OwnerChanged")
          .withArgs(newOwner.address);
        expect(await account.owner()).to.equal(newOwner.address);
      });
    });

    describe("Changing guardian", () => {
      before(async () => {
        account = await deployAccount({
          argent,
          ownerAddress,
          guardianAddress,
          connect: [owner, guardian],
        });
      });

      it("Should revert with the wrong owner signature", async () => {
        const promise = account.connect([wrongOwner, guardian]).changeGuardian(newGuardian.address);
        await expect(promise).to.be.rejectedWith("argent/invalid-owner-signature");
      });

      it("Should revert with the wrong guardian signature", async () => {
        const promise = account.connect([owner, wrongGuardian]).changeGuardian(newGuardian.address);
        await expect(promise).to.be.rejectedWith("argent/invalid-guardian-signature");
      });

      it("Should work with the correct signatures", async () => {
        expect(await account.guardian()).to.equal(guardian.address);

        const promise = account.changeGuardian(newGuardian.address);

        await expect(promise)
          .to.emit(account, "GuardianChanged")
          .withArgs(newGuardian.address);
        expect(await account.guardian()).to.equal(newGuardian.address);
      });
    });

    describe("Changing guardian backup", () => {
      before(async () => {
        account = await deployAccount({
          argent,
          ownerAddress,
          guardianAddress,
          connect: [owner, guardian],
        });
      });

      it("Should revert with the wrong owner signature", async () => {
        const promise = account.connect([wrongOwner, guardian]).changeGuardianBackup(newGuardianBackup.address);
        await expect(promise).to.be.rejectedWith("argent/invalid-owner-signature");
      });

      it("Should revert with the wrong guardian signature", async () => {
        const promise = account.connect([owner, wrongGuardian]).changeGuardianBackup(newGuardianBackup.address);
        await expect(promise).to.be.rejectedWith("argent/invalid-guardian-signature");
      });

      it("Should work with the correct signatures", async () => {
        expect(await account.guardianBackup()).to.equal(AddressZero);

        const promise = account.changeGuardianBackup(newGuardianBackup.address);

        await expect(promise)
          .to.emit(account, "GuardianBackupChanged")
          .withArgs(newGuardianBackup.address);
        expect(await account.guardianBackup()).to.equal(newGuardianBackup.address);
      });

      it("Should fail when no guardian", async () => {
        const account = await deployAccount({ argent, ownerAddress, guardianAddress: AddressZero, connect: [owner] });
        const promise = account.changeGuardianBackup(newGuardianBackup.address);
        await expect(promise).to.be.rejectedWith("argent/guardian-required");
      });
    });

    describe("Escape triggering", () => {
      it("Should run triggerEscapeGuardian() by owner", async () => {
        const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner] });

        const escapeBefore = await account.escape();
        expect(escapeBefore.activeAt).to.equal(0n);
        expect(escapeBefore.escapeType).to.equal(noEscape);

        const response = await account.triggerEscapeGuardian();
        const receipt = await response.wait();
        const { timestamp } = await provider.getBlock(receipt.blockHash);
        const activeAtExpected = timestamp + escapeSecurityPeriod;
        await expect(response)
          .to.emit(account, "EscapeGuardianTriggerred")
          .withArgs(activeAtExpected);

        const escapeAfter = await account.escape();
        expect(escapeAfter.activeAt).to.equal(activeAtExpected);
        expect(escapeAfter.escapeType).to.equal(guardianEscape);
      });

      it("Should run triggerEscapeOwner() by guardian", async () => {
        const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [guardian] });

        const escapeBefore = await account.escape();
        expect(escapeBefore.activeAt).to.equal(0n);
        expect(escapeBefore.escapeType).to.equal(noEscape);

        const response = await account.triggerEscapeOwner();
        const receipt = await response.wait();
        const { timestamp } = await provider.getBlock(receipt.blockHash);
        const activeAtExpected = timestamp + escapeSecurityPeriod;
        await expect(response)
          .to.emit(account, "EscapeOwnerTriggerred")
          .withArgs(activeAtExpected);

        const escapeAfter = await account.escape();
        expect(escapeAfter.activeAt).to.equal(activeAtExpected);
        expect(escapeAfter.escapeType).to.equal(ownerEscape);
      });

      it("Should run triggerEscapeOwner() by guardian backup", async () => {
        const account = await deployAccount({ argent, ownerAddress, guardianAddress });
        const backupResponse = await account.connect([owner, guardian]).changeGuardianBackup(newGuardianBackup.address);
        await backupResponse.wait();

        const escapeBefore = await account.escape();
        expect(escapeBefore.activeAt).to.equal(0n);
        expect(escapeBefore.escapeType).to.equal(noEscape);

        const response = await account.connect([newGuardianBackup]).triggerEscapeOwner();
        const receipt = await response.wait();
        const { timestamp } = await provider.getBlock(receipt.blockHash);
        const activeAtExpected = timestamp + escapeSecurityPeriod;
        await expect(response)
          .to.emit(account, "EscapeOwnerTriggerred")
          .withArgs(activeAtExpected);

        const escapeAfter = await account.escape();
        expect(escapeAfter.activeAt).to.equal(activeAtExpected);
        expect(escapeAfter.escapeType).to.equal(ownerEscape);
      });
    });

    describe("Escaping", () => {
      if (escapeSecurityPeriod > 60) {
        throw new Error("These tests require an escape security period of less than 60 seconds");
      }

      it("Should escape guardian", async () => {
        const account = await deployAccount({
          argent,
          ownerAddress,
          guardianAddress,
          connect: [owner],
          funds: "0.00015",
        });

        // trigger escape
        await expect(account.triggerEscapeGuardian()).to.emit(account, "EscapeGuardianTriggerred");

        const escape = await account.escape();
        expect(escape.activeAt).to.be.greaterThan(0n);
        expect(escape.escapeType).to.equal(guardianEscape);

        // should fail to escape before the end of the period
        await expect(account.escapeGuardian(newGuardian.address)).to.be.rejectedWith("argent/inactive-escape");

        // wait security period
        await waitForTimestamp(escape.activeAt, provider);

        expect(await account.guardian()).to.equal(guardian.address);

        // should escape after the security period
        const promise = account.escapeGuardian(newGuardian.address);
        await expect(promise)
          .to.emit(account, "GuardianEscaped")
          .withArgs(newGuardian.address);

        expect(await account.guardian()).to.equal(newGuardian.address);

        // escape should be cleared
        const postEscape = await account.escape();
        expect(postEscape.activeAt).to.equal(0n);
        expect(postEscape.escapeType).to.equal(noEscape);
      });

      it("Should escape owner", async () => {
        const account = await deployAccount({
          argent,
          ownerAddress,
          guardianAddress,
          connect: [guardian],
          funds: "0.00015",
        });

        // trigger escape
        await expect(account.triggerEscapeOwner()).to.emit(account, "EscapeOwnerTriggerred");

        const escape = await account.escape();
        expect(escape.activeAt).to.be.greaterThan(0n);
        expect(escape.escapeType).to.equal(ownerEscape);

        // should fail to escape before the end of the period
        await expect(account.escapeOwner(newOwner.address)).to.be.rejectedWith("argent/inactive-escape");

        // wait security period
        await waitForTimestamp(escape.activeAt, provider);

        expect(await account.owner()).to.equal(owner.address);

        // should escape after the security period
        const promise = account.escapeOwner(newOwner.address);
        await expect(promise)
          .to.emit(account, "OwnerEscaped")
          .withArgs(newOwner.address);

        expect(await account.owner()).to.equal(newOwner.address);

        // escape should be cleared
        const postEscape = await account.escape();
        expect(postEscape.activeAt).to.equal(0n);
        expect(postEscape.escapeType).to.equal(noEscape);
      });
    });

    describe("Escape overriding", () => {
      it("Should allow owner to override a owner escape", async () => {
        const account = await deployAccount({ argent, ownerAddress, guardianAddress });

        // guardian triggers a owner escape
        const guardianResponse = await account.connect([guardian]).triggerEscapeOwner();
        await guardianResponse.wait();

        const firstEscape = await account.escape();
        expect(firstEscape.activeAt).to.be.greaterThan(0n);
        expect(firstEscape.escapeType).to.equal(ownerEscape);

        // TODO: do evm_increaseTime + evm_mine here when testing locally

        // owner overrides the guardian's escape
        const ownerResponse = await account.connect([owner]).triggerEscapeGuardian();
        await ownerResponse.wait();

        const secondEscape = await account.escape();
        expect(secondEscape.activeAt).to.be.greaterThan(firstEscape.activeAt);
        expect(secondEscape.escapeType).to.equal(guardianEscape);
      });

      it("Should forbid guardian to override a guardian escape", async () => {
        const account = await deployAccount({ argent, ownerAddress, guardianAddress });

        // owner triggers a guardian escape
        const response = await account.connect([owner]).triggerEscapeGuardian();
        await response.wait();

        const escape = await account.escape();
        expect(escape.activeAt).to.be.greaterThan(0n);
        expect(escape.escapeType).to.equal(guardianEscape);

        // TODO: do evm_increaseTime + evm_mine here when testing locally

        // guardian cannot override
        const promise = account.connect([guardian]).triggerEscapeOwner();
        await expect(promise).to.be.rejectedWith("argent/cannot-override-owner-escape");

        const secondEscape = await account.escape();
        expect(secondEscape.activeAt).to.equal(escape.activeAt);
        expect(secondEscape.escapeType).to.equal(guardianEscape);
      });
    });

    it("Should cancel an escape", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      // guardian triggers a owner escape
      const response = await account.connect([guardian]).triggerEscapeOwner();
      await response.wait();

      const escape = await account.escape();
      expect(escape.activeAt).to.be.greaterThan(0n);
      expect(escape.escapeType).to.equal(ownerEscape);

      // should fail to cancel with just the owner signature
      const rejectingPromise = account.connect([owner]).cancelEscape();
      await expect(rejectingPromise).to.be.rejectedWith("argent/invalid-guardian-signature");

      const resolvingPromise = account.connect([owner, guardian]).cancelEscape();
      await expect(resolvingPromise).to.emit(account, "EscapeCancelled");

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

    let account: ArgentAccount;

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
    });

    it("Should verify on the account", async () => {
      const signature = ethers.utils.concat([await signWith(owner), await signWith(guardian)]);
      expect(await account.isValidSignature(hash, signature)).to.equal(eip1271SuccessReturnValue);
    });

    it("Should verify with a single signature when not using a guardian", async () => {
      const accountNoGuardian = await deployAccount({ argent, ownerAddress, guardianAddress: AddressZero });
      const signature = await signWith(owner);
      expect(await accountNoGuardian.isValidSignature(hash, signature)).to.equal(eip1271SuccessReturnValue);
    });

    it("Should fail to verify using incorrect owners", async () => {
      let signature = ethers.utils.concat([await signWith(owner), await signWith(wrongGuardian)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = ethers.utils.concat([await signWith(owner), await signWith(owner)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = ethers.utils.concat([await signWith(guardian), await signWith(guardian)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;
    });

    it("Should fail to verify using zeros in any position", async () => {
      let signature = ethers.utils.concat([new Uint8Array(65), await signWith(guardian)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = ethers.utils.concat([await signWith(owner), new Uint8Array(65)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = new Uint8Array(130);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;
    });
  });
});
