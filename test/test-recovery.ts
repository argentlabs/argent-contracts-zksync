import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount, deployAccount } from "../scripts/account.service";
import { checkDeployer, getDeployer } from "../scripts/deployer.service";
import { getTestInfrastructure } from "../scripts/infrastructure.service";
import { ArgentInfrastructure } from "../scripts/model";
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
const { deployer, provider } = getDeployer();

describe("Recovery", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;

  let noEscape: number;
  let ownerEscape: number;
  let guardianEscape: number;
  let escapeSecurityPeriod: number; // in seconds

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
    ({ dummyAccount: account } = argent);

    noEscape = await account.NO_ESCAPE();
    ownerEscape = await account.OWNER_ESCAPE();
    guardianEscape = await account.GUARDIAN_ESCAPE();
    escapeSecurityPeriod = await account.ESCAPE_SECURITY_PERIOD();
  });

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

      await expect(promise).to.emit(account, "OwnerChanged").withArgs(newOwner.address);
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

      await expect(promise).to.emit(account, "GuardianChanged").withArgs(newGuardian.address);
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

      await expect(promise).to.emit(account, "GuardianBackupChanged").withArgs(newGuardianBackup.address);
      expect(await account.guardianBackup()).to.equal(newGuardianBackup.address);
    });

    it("Should fail when no guardian", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress: AddressZero, connect: [owner] });
      const promise = account.changeGuardianBackup(newGuardianBackup.address);
      await expect(promise).to.be.rejectedWith("argent/guardian-required");
    });
  });

  // TODO: unskip when zkSync allows fetching "L1 batch blocks" instead of just miniblocks
  describe.skip("Escape triggering", () => {
    it("Should run triggerEscapeGuardian() by owner", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner] });

      const escapeBefore = await account.escape();
      expect(escapeBefore.activeAt).to.equal(0n);
      expect(escapeBefore.escapeType).to.equal(noEscape);

      const response = await account.triggerEscapeGuardian();
      const receipt = await response.wait();
      const { timestamp } = await provider.getBlock(receipt.blockHash);
      const activeAtExpected = timestamp + escapeSecurityPeriod;
      await expect(response).to.emit(account, "EscapeGuardianTriggerred").withArgs(activeAtExpected);

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
      await expect(response).to.emit(account, "EscapeOwnerTriggerred").withArgs(activeAtExpected);

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
      await expect(response).to.emit(account, "EscapeOwnerTriggerred").withArgs(activeAtExpected);

      const escapeAfter = await account.escape();
      expect(escapeAfter.activeAt).to.equal(activeAtExpected);
      expect(escapeAfter.escapeType).to.equal(ownerEscape);
    });
  });

  // TOOD: update waitForTimestamp
  describe.skip("Escaping", () => {
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
      await expect(promise).to.emit(account, "GuardianEscaped").withArgs(newGuardian.address);

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
      await expect(promise).to.emit(account, "OwnerEscaped").withArgs(newOwner.address);

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
      expect(secondEscape.activeAt).to.be.greaterThanOrEqual(firstEscape.activeAt); // TODO: greaterThan after evm_mine
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
