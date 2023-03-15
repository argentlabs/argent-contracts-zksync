import { expect } from "chai";
import * as zksync from "zksync-web3";
import { connect, deployAccount } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { waitForL1BatchBlock, waitForTimestamp } from "../src/provider.service";
import { getEscapeSignature } from "../src/recovery.service";
import { ArgentAccount } from "../typechain-types";
import {
  AddressZero,
  deployer,
  EscapeStruct,
  guardian,
  guardianAddress,
  owner,
  ownerAddress,
  provider,
  wrongGuardian,
  wrongOwner,
} from "./fixtures";

const newOwner = zksync.Wallet.createRandom();
const newGuardian = zksync.Wallet.createRandom();
const newGuardianBackup = zksync.Wallet.createRandom();

describe("Recovery", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;

  let ownerEscapeType: number;
  let guardianEscapeType: number;
  let escapeSecurityPeriod: number; // in seconds

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);

    const account = argent.implementation;
    ownerEscapeType = await account.OWNER_ESCAPE_TYPE();
    guardianEscapeType = await account.GUARDIAN_ESCAPE_TYPE();
    escapeSecurityPeriod = await account.escapeSecurityPeriod();
  });

  describe("Changing owner", () => {
    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner, guardian] });
    });

    it("Should revert with the wrong owner signature", async () => {
      const promise = connect(account, [wrongOwner, guardian]).changeOwner(newOwner.address);
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");
    });

    it("Should revert with the wrong guardian signature", async () => {
      const promise = connect(account, [owner, wrongGuardian]).changeOwner(newOwner.address);
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");
    });

    it("Should work with the correct signatures", async () => {
      await expect(account.owner()).to.eventually.equal(owner.address);

      const promise = account.changeOwner(newOwner.address);

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

  const nullEscape = { activeAt: 0, escapeType: 0, newSigner: AddressZero };

  const expectEqualEscapes = (actual: EscapeStruct, expected: EscapeStruct) => {
    expect(actual.activeAt).to.equal(expected.activeAt);
    expect(actual.escapeType).to.equal(expected.escapeType);
    expect(actual.newSigner).to.equal(expected.newSigner);
  };

  describe("Escape triggering", () => {
    it("Should run triggerEscapeGuardian() by owner", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner] });

      const [escapeBefore] = await account.escapeWithStatus();
      expectEqualEscapes(escapeBefore, nullEscape);

      const signature = await getEscapeSignature(newGuardian, account, "triggerEscapeGuardian");

      const response = await account.triggerEscapeGuardian(newGuardian.address, signature);
      const { timestamp } = await waitForL1BatchBlock(response, provider);
      const activeAt = timestamp + escapeSecurityPeriod;
      await expect(response).to.emit(account, "EscapeGuardianTriggerred").withArgs(activeAt, newGuardian.address);

      const [escape] = await account.escapeWithStatus();
      expectEqualEscapes(escape, { activeAt, escapeType: guardianEscapeType, newSigner: newGuardian.address });
    });

    it("Should run triggerEscapeOwner() by guardian", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [guardian] });

      const [escapeBefore] = await account.escapeWithStatus();
      expectEqualEscapes(escapeBefore, nullEscape);

      const signature = await getEscapeSignature(newOwner, account, "triggerEscapeOwner");

      const response = await account.triggerEscapeOwner(newOwner.address, signature);
      const { timestamp } = await waitForL1BatchBlock(response, provider);
      const activeAt = timestamp + escapeSecurityPeriod;
      await expect(response).to.emit(account, "EscapeOwnerTriggerred").withArgs(activeAt, newOwner.address);

      const [escape] = await account.escapeWithStatus();
      expectEqualEscapes(escape, { activeAt, escapeType: ownerEscapeType, newSigner: newOwner.address });
    });

    it("Should run triggerEscapeOwner() by guardian backup", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });
      const backupResponse = await connect(account, [owner, guardian]).changeGuardianBackup(newGuardianBackup.address);
      await backupResponse.wait();

      const [escapeBefore] = await account.escapeWithStatus();
      expectEqualEscapes(escapeBefore, nullEscape);

      const signature = await getEscapeSignature(newOwner, account, "triggerEscapeOwner");

      const response = await connect(account, [newGuardianBackup]).triggerEscapeOwner(newOwner.address, signature);
      const { timestamp } = await waitForL1BatchBlock(response, provider);
      const activeAt = timestamp + escapeSecurityPeriod;
      await expect(response).to.emit(account, "EscapeOwnerTriggerred").withArgs(activeAt, newOwner.address);

      const [escape] = await account.escapeWithStatus();
      expectEqualEscapes(escape, { activeAt, escapeType: ownerEscapeType, newSigner: newOwner.address });
    });

    it.skip("Should run trigger methods twice", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      let promise = connect(account, [guardian]).triggerEscapeOwner();
      await expect(promise).to.emit(account, "EscapeOwnerTriggerred");

      promise = connect(account, [guardian]).triggerEscapeOwner();
      await expect(promise).to.emit(account, "EscapeOwnerTriggerred");

      promise = connect(account, [owner]).triggerEscapeGuardian();
      await expect(promise).to.emit(account, "EscapeGuardianTriggerred");

      promise = connect(account, [owner]).triggerEscapeGuardian();
      await expect(promise).to.emit(account, "EscapeGuardianTriggerred");
    });
  });

  describe.only("Escaping", () => {
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
      const signature = await getEscapeSignature(newGuardian, account, "triggerEscapeGuardian");
      const response = await account.triggerEscapeGuardian(newGuardian.address, signature);
      await response.wait();

      // should fail to escape before the end of the period
      await expect(account.escapeGuardian(newGuardian.address)).to.be.rejectedWith("argent/inactive-escape");

      // wait security period
      const [{ activeAt }] = await account.escapeWithStatus();
      await waitForTimestamp(activeAt, provider);

      await expect(account.guardian()).to.eventually.equal(guardian.address);

      // should escape after the security period
      const promise = account.escapeGuardian(newGuardian.address);
      await expect(promise).to.emit(account, "GuardianEscaped").withArgs(newGuardian.address);

      await expect(account.guardian()).to.eventually.equal(newGuardian.address);

      // escape should be cleared
      const [postEscape] = await account.escapeWithStatus();
      expectEqualEscapes(postEscape, nullEscape);
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
      const signature = await getEscapeSignature(newOwner, account, "triggerEscapeOwner");
      const response = await account.triggerEscapeOwner(newOwner.address, signature);
      await response.wait();

      // should fail to escape before the end of the period
      await expect(account.escapeOwner(newOwner.address)).to.be.rejectedWith("argent/inactive-escape");

      // wait security period
      const [{ activeAt }] = await account.escapeWithStatus();
      await waitForTimestamp(activeAt, provider);

      await expect(account.owner()).to.eventually.equal(owner.address);

      // should escape after the security period
      const promise = account.escapeOwner(newOwner.address);
      await expect(promise).to.emit(account, "OwnerEscaped").withArgs(newOwner.address);

      await expect(account.owner()).to.eventually.equal(newOwner.address);

      // escape should be cleared
      const [postEscape] = await account.escapeWithStatus();
      expectEqualEscapes(postEscape, nullEscape);
    });
  });

  describe("Escape overriding", () => {
    it("Should allow owner to override an owner escape", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      // guardian triggers a owner escape
      const guardianResponse = await connect(account, [guardian]).triggerEscapeOwner();
      await guardianResponse.wait();

      const [firstEscape] = await account.escapeWithStatus();
      expect(firstEscape.activeAt).to.be.greaterThan(0n);
      expect(firstEscape.escapeType).to.equal(ownerEscapeType);

      // TODO: do evm_increaseTime + evm_mine here when testing locally

      // owner overrides the guardian's escape
      const ownerResponse = await connect(account, [owner]).triggerEscapeGuardian();
      await ownerResponse.wait();

      const [secondEscape] = await account.escapeWithStatus();
      expect(secondEscape.activeAt).to.be.greaterThanOrEqual(firstEscape.activeAt); // TODO: greaterThan after evm_mine
      expect(secondEscape.escapeType).to.equal(guardianEscapeType);
    });

    it("Should forbid guardian to override a guardian escape", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      // owner triggers a guardian escape
      const response = await connect(account, [owner]).triggerEscapeGuardian();
      await response.wait();

      const [escape] = await account.escapeWithStatus();
      expect(escape.activeAt).to.be.greaterThan(0n);
      expect(escape.escapeType).to.equal(guardianEscapeType);

      // TODO: do evm_increaseTime + evm_mine here when testing locally

      // guardian cannot override
      const promise = connect(account, [guardian]).triggerEscapeOwner();
      await expect(promise).to.be.rejectedWith("argent/cannot-override-owner-escape");

      const [secondEscape] = await account.escapeWithStatus();
      expect(secondEscape.activeAt).to.equal(escape.activeAt);
      expect(secondEscape.escapeType).to.equal(guardianEscapeType);
    });
  });

  describe("Canceling escape", () => {
    it("Should cancel an escape", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      // guardian triggers a owner escape
      const response = await connect(account, [guardian]).triggerEscapeOwner();
      await response.wait();

      const [escape] = await account.escapeWithStatus();
      expect(escape.activeAt).to.be.greaterThan(0n);
      expect(escape.escapeType).to.equal(ownerEscapeType);

      // should fail to cancel with just the owner signature
      const rejectingPromise = connect(account, [owner]).cancelEscape();
      await expect(rejectingPromise).to.be.rejectedWith("Account validation returned invalid magic value");

      const resolvingPromise = connect(account, [owner, guardian]).cancelEscape();
      await expect(resolvingPromise).to.emit(account, "EscapeCancelled");

      const [secondEscape] = await account.escapeWithStatus();
      expect(secondEscape.activeAt).to.equal(0n);
      expect(secondEscape.escapeType).to.equal(noEscape);
    });
  });
});
