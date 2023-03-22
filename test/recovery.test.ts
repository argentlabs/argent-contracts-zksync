import { expect } from "chai";
import { connect, deployAccount } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure, EscapeStatus, EscapeType } from "../src/model";
import { waitForL1BatchBlock, waitForTimestamp } from "../src/provider.service";
import { changeOwnerWithSignature, signChangeOwner } from "../src/recovery.service";
import { ArgentAccount } from "../typechain-types";
import {
  AddressZero,
  deployer,
  EscapeStruct,
  guardian,
  guardianAddress,
  newGuardian,
  newGuardianBackup,
  newOwner,
  owner,
  ownerAddress,
  provider,
  wrongGuardian,
  wrongOwner,
} from "./fixtures";

describe("Recovery", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;

  let escapeSecurityPeriod: number; // in seconds
  let escapeExpiryPeriod: number; // in seconds

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);

    const account = argent.implementation;
    escapeSecurityPeriod = await account.escapeSecurityPeriod();
    escapeExpiryPeriod = await account.escapeExpiryPeriod();
  });

  describe("Changing owner", () => {
    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner, guardian] });
    });

    it("Should revert with the wrong old owner signature", async () => {
      const promise = changeOwnerWithSignature(newOwner, connect(account, [wrongOwner, guardian]));
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");
    });

    it("Should revert with the wrong new owner signature", async () => {
      let signature = await newOwner.signMessage("hello");
      let promise = account.changeOwner(newOwner.address, signature);
      await expect(promise).to.be.rejectedWith("argent/invalid-owner-sig");

      signature = await signChangeOwner(wrongOwner, account);
      promise = account.changeOwner(newOwner.address, signature);
      await expect(promise).to.be.rejectedWith("argent/invalid-owner-sig");
    });

    it("Should revert with the wrong guardian signature", async () => {
      const promise = changeOwnerWithSignature(newOwner, connect(account, [owner, wrongGuardian]));
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");
    });

    it("Should work with the correct signatures", async () => {
      await expect(account.owner()).to.eventually.equal(owner.address);

      const promise = changeOwnerWithSignature(newOwner, account);

      await expect(promise).to.emit(account, "OwnerChanged").withArgs(newOwner.address);
      await expect(account.owner()).to.eventually.equal(newOwner.address);
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
      const promise = connect(account, [wrongOwner, guardian]).changeGuardian(newGuardian.address);
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");
    });

    it("Should revert with the wrong guardian signature", async () => {
      const promise = connect(account, [owner, wrongGuardian]).changeGuardian(newGuardian.address);
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");
    });

    it("Should work with the correct signatures", async () => {
      await expect(account.guardian()).to.eventually.equal(guardian.address);

      const promise = account.changeGuardian(newGuardian.address);

      await expect(promise).to.emit(account, "GuardianChanged").withArgs(newGuardian.address);
      await expect(account.guardian()).to.eventually.equal(newGuardian.address);
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
      const promise = connect(account, [wrongOwner, guardian]).changeGuardianBackup(newGuardianBackup.address);
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");
    });

    it("Should revert with the wrong guardian signature", async () => {
      const promise = connect(account, [owner, wrongGuardian]).changeGuardianBackup(newGuardianBackup.address);
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");
    });

    it("Should work with the correct signatures", async () => {
      await expect(account.guardianBackup()).to.eventually.equal(AddressZero);

      const promise = account.changeGuardianBackup(newGuardianBackup.address);

      await expect(promise).to.emit(account, "GuardianBackupChanged").withArgs(newGuardianBackup.address);
      await expect(account.guardianBackup()).to.eventually.equal(newGuardianBackup.address);
    });

    it("Should fail when no guardian", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress: AddressZero, connect: [owner] });
      const promise = account.changeGuardianBackup(newGuardianBackup.address);
      await expect(promise).to.be.rejectedWith("argent/guardian-required");
    });
  });

  const nullEscape = { activeAt: 0, escapeType: EscapeType.None, newSigner: AddressZero };

  const expectEqualEscapes = (actual: EscapeStruct, expected: EscapeStruct) => {
    expect(actual.activeAt).to.equal(expected.activeAt);
    expect(actual.escapeType).to.equal(expected.escapeType);
    expect(actual.newSigner).to.equal(expected.newSigner);
  };

  describe("Escape triggering", () => {
    it("Should run triggerEscapeGuardian() by owner", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner] });

      const [escapeBefore] = await account.getEscape();
      expectEqualEscapes(escapeBefore, nullEscape);

      const response = await account.triggerEscapeGuardian(newGuardian.address);
      const { timestamp } = await waitForL1BatchBlock(response, provider);
      const activeAt = timestamp + escapeSecurityPeriod;
      await expect(response).to.emit(account, "EscapeGuardianTriggerred").withArgs(activeAt, newGuardian.address);

      const [escape] = await account.getEscape();
      expectEqualEscapes(escape, { activeAt, escapeType: EscapeType.Guardian, newSigner: newGuardian.address });
    });

    it("Should run triggerEscapeOwner() by guardian", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [guardian] });

      const [escapeBefore] = await account.getEscape();
      expectEqualEscapes(escapeBefore, nullEscape);

      const response = await account.triggerEscapeOwner(newOwner.address);
      const { timestamp } = await waitForL1BatchBlock(response, provider);
      const activeAt = timestamp + escapeSecurityPeriod;
      await expect(response).to.emit(account, "EscapeOwnerTriggerred").withArgs(activeAt, newOwner.address);

      const [escape] = await account.getEscape();
      expectEqualEscapes(escape, { activeAt, escapeType: EscapeType.Owner, newSigner: newOwner.address });
    });

    it("Should run triggerEscapeOwner() by guardian backup", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });
      const backupResponse = await connect(account, [owner, guardian]).changeGuardianBackup(newGuardianBackup.address);
      await backupResponse.wait();

      const [escapeBefore] = await account.getEscape();
      expectEqualEscapes(escapeBefore, nullEscape);

      const response = await connect(account, [newGuardianBackup]).triggerEscapeOwner(newOwner.address);
      const { timestamp } = await waitForL1BatchBlock(response, provider);
      const activeAt = timestamp + escapeSecurityPeriod;
      await expect(response).to.emit(account, "EscapeOwnerTriggerred").withArgs(activeAt, newOwner.address);

      const [escape] = await account.getEscape();
      expectEqualEscapes(escape, { activeAt, escapeType: EscapeType.Owner, newSigner: newOwner.address });
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
        funds: "0.0004",
      });

      // trigger escape
      const response = await account.triggerEscapeGuardian(newGuardian.address);
      await response.wait();

      // should fail to escape before the end of the period
      await expect(account.escapeGuardian()).to.be.rejectedWith("argent/inactive-escape");

      // wait security period
      const [{ activeAt }] = await account.getEscape();
      await waitForTimestamp(activeAt, provider);

      // should escape after the security period
      await expect(account.guardian()).to.eventually.equal(guardian.address);
      const promise = account.escapeGuardian();
      await expect(promise).to.emit(account, "GuardianEscaped").withArgs(newGuardian.address);
      await expect(account.guardian()).to.eventually.equal(newGuardian.address);

      // escape should be cleared
      const [escape, statusAfterEscape] = await account.getEscape();
      expectEqualEscapes(escape, nullEscape);
      expect(statusAfterEscape).to.equal(EscapeStatus.None);
    });

    it("Should escape owner", async () => {
      const account = await deployAccount({
        argent,
        ownerAddress,
        guardianAddress,
        connect: [guardian],
        funds: "0.0005",
      });

      // trigger escape
      const response = await account.triggerEscapeOwner(newOwner.address);
      await response.wait();

      // should fail to escape before the end of the period
      await expect(account.escapeOwner()).to.be.rejectedWith("argent/inactive-escape");

      // wait security period
      const [{ activeAt }] = await account.getEscape();
      await waitForTimestamp(activeAt, provider);

      // should escape after the security period
      await expect(account.owner()).to.eventually.equal(owner.address);
      const promise = account.escapeOwner();
      await expect(promise).to.emit(account, "OwnerEscaped").withArgs(newOwner.address);
      await expect(account.owner()).to.eventually.equal(newOwner.address);

      // escape should be cleared
      const [escape, statusAfterEscape] = await account.getEscape();
      expectEqualEscapes(escape, nullEscape);
      expect(statusAfterEscape).to.equal(EscapeStatus.None);
    });
  });

  describe("Escape overriding", () => {
    it("Should allow owner to override an owner escape immediately", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      // guardian triggers a owner escape
      const guardianResponse = await connect(account, [guardian]).triggerEscapeOwner(newOwner.address);
      await guardianResponse.wait();

      const [firstEscape] = await account.getEscape();
      expect(firstEscape.activeAt).to.be.greaterThan(0n);
      expect(firstEscape.escapeType).to.equal(EscapeType.Owner);

      // TODO: do evm_increaseTime + evm_mine here when testing locally

      // owner overrides the guardian's escape
      const ownerResponse = await connect(account, [owner]).triggerEscapeGuardian(newGuardian.address);
      await ownerResponse.wait();

      const [secondEscape] = await account.getEscape();
      expect(secondEscape.activeAt).to.be.greaterThanOrEqual(firstEscape.activeAt); // TODO: greaterThan after evm_mine
      expect(secondEscape.escapeType).to.equal(EscapeType.Guardian);
    });

    it("Should forbid guardian to override a guardian escape", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      // owner triggers a guardian escape
      const response = await connect(account, [owner]).triggerEscapeGuardian(newGuardian.address);
      await response.wait();

      const [escape, status] = await account.getEscape();
      expect(escape.activeAt).to.be.greaterThan(0n);
      expect(escape.escapeType).to.equal(EscapeType.Guardian);

      // TODO: do evm_increaseTime + evm_mine here when testing locally

      // guardian cannot override in Triggered state
      let promise = connect(account, [guardian]).triggerEscapeOwner(newOwner.address);
      await expect(promise).to.be.rejectedWith("argent/cannot-override-escape");

      const [secondEscape, secondStatus] = await account.getEscape();
      expectEqualEscapes(secondEscape, escape);
      expect(secondStatus).to.equal(status);

      await waitForTimestamp(escape.activeAt, provider);

      // guardian cannot override in Active state
      promise = connect(account, [guardian]).triggerEscapeOwner(newOwner.address);
      await expect(promise).to.be.rejectedWith("argent/cannot-override-escape");

      await waitForTimestamp(escape.activeAt + escapeExpiryPeriod, provider);

      // guardian can override in Expired state
      promise = connect(account, [guardian]).triggerEscapeOwner(newOwner.address);
      await expect(promise).to.emit(account, "EscapeOwnerTriggerred");
    });
  });

  describe("Canceling escape", () => {
    it("Should cancel an escape", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      let promise = connect(account, [owner, guardian]).cancelEscape();
      await expect(promise).to.be.rejectedWith("null-escape");

      // guardian triggers a owner escape
      const response = await connect(account, [guardian]).triggerEscapeOwner(newOwner.address);
      await response.wait();

      const [escape] = await account.getEscape();
      expect(escape.activeAt).to.be.greaterThan(0n);
      expect(escape.escapeType).to.equal(EscapeType.Owner);

      // should fail to cancel with just the owner signature
      promise = connect(account, [owner]).cancelEscape();
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");

      promise = connect(account, [owner, guardian]).cancelEscape();
      await expect(promise).to.emit(account, "EscapeCanceled");

      const [secondEscape, secondStatus] = await account.getEscape();
      expectEqualEscapes(secondEscape, nullEscape);
      expect(secondStatus).to.equal(EscapeStatus.None);
    });
  });
});
