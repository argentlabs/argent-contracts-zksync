import { expect } from "chai";
import * as zksync from "zksync-web3";
import { connect, deployAccount } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { waitForL1BatchBlock, waitForTimestamp } from "../src/provider.service";
import { triggerEscapeGuardian, triggerEscapeOwner } from "../src/recovery.service";
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

      const [escapeBefore] = await account.getEscape();
      expectEqualEscapes(escapeBefore, nullEscape);

      const response = await triggerEscapeGuardian(newGuardian, account);
      const { timestamp } = await waitForL1BatchBlock(response, provider);
      const activeAt = timestamp + escapeSecurityPeriod;
      await expect(response).to.emit(account, "EscapeGuardianTriggerred").withArgs(activeAt, newGuardian.address);

      const [escape] = await account.getEscape();
      expectEqualEscapes(escape, { activeAt, escapeType: guardianEscapeType, newSigner: newGuardian.address });
    });

    it("Should run triggerEscapeOwner() by guardian", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [guardian] });

      const [escapeBefore] = await account.getEscape();
      expectEqualEscapes(escapeBefore, nullEscape);

      const response = await triggerEscapeOwner(newOwner, account);
      const { timestamp } = await waitForL1BatchBlock(response, provider);
      const activeAt = timestamp + escapeSecurityPeriod;
      await expect(response).to.emit(account, "EscapeOwnerTriggerred").withArgs(activeAt, newOwner.address);

      const [escape] = await account.getEscape();
      expectEqualEscapes(escape, { activeAt, escapeType: ownerEscapeType, newSigner: newOwner.address });
    });

    it("Should run triggerEscapeOwner() by guardian backup", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });
      const backupResponse = await connect(account, [owner, guardian]).changeGuardianBackup(newGuardianBackup.address);
      await backupResponse.wait();

      const [escapeBefore] = await account.getEscape();
      expectEqualEscapes(escapeBefore, nullEscape);

      const response = await triggerEscapeOwner(newOwner, connect(account, [newGuardianBackup]));
      const { timestamp } = await waitForL1BatchBlock(response, provider);
      const activeAt = timestamp + escapeSecurityPeriod;
      await expect(response).to.emit(account, "EscapeOwnerTriggerred").withArgs(activeAt, newOwner.address);

      const [escape] = await account.getEscape();
      expectEqualEscapes(escape, { activeAt, escapeType: ownerEscapeType, newSigner: newOwner.address });
    });

    it("Should run trigger methods twice", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      let promise = triggerEscapeOwner(zksync.Wallet.createRandom(), connect(account, [guardian]));
      await expect(promise).to.emit(account, "EscapeOwnerTriggerred");

      promise = triggerEscapeOwner(zksync.Wallet.createRandom(), connect(account, [guardian]));
      await expect(promise).to.emit(account, "EscapeOwnerTriggerred");

      promise = triggerEscapeGuardian(zksync.Wallet.createRandom(), connect(account, [owner]));
      await expect(promise).to.emit(account, "EscapeGuardianTriggerred");

      promise = triggerEscapeGuardian(zksync.Wallet.createRandom(), connect(account, [owner]));
      await expect(promise).to.emit(account, "EscapeGuardianTriggerred");
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
      const response = await triggerEscapeGuardian(newGuardian, account);
      await response.wait();

      // should fail to escape before the end of the period
      await expect(account.escapeGuardian(newGuardian.address)).to.be.rejectedWith("argent/inactive-escape");

      // wait security period
      const [{ activeAt }] = await account.getEscape();
      await waitForTimestamp(activeAt, provider);

      await expect(account.guardian()).to.eventually.equal(guardian.address);

      // should escape after the security period
      const promise = account.escapeGuardian(newGuardian.address);
      await expect(promise).to.emit(account, "GuardianEscaped").withArgs(newGuardian.address);

      await expect(account.guardian()).to.eventually.equal(newGuardian.address);

      // escape should be cleared
      const [postEscape] = await account.getEscape();
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
      const response = await triggerEscapeOwner(newOwner, account);
      await response.wait();

      // should fail to escape before the end of the period
      await expect(account.escapeOwner(newOwner.address)).to.be.rejectedWith("argent/inactive-escape");

      // wait security period
      const [{ activeAt }] = await account.getEscape();
      await waitForTimestamp(activeAt, provider);

      await expect(account.owner()).to.eventually.equal(owner.address);

      // should escape after the security period
      const promise = account.escapeOwner(newOwner.address);
      await expect(promise).to.emit(account, "OwnerEscaped").withArgs(newOwner.address);

      await expect(account.owner()).to.eventually.equal(newOwner.address);

      // escape should be cleared
      const [postEscape] = await account.getEscape();
      expectEqualEscapes(postEscape, nullEscape);
    });
  });

  describe("Escape overriding", () => {
    it("Should allow owner to override an owner escape", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      // guardian triggers a owner escape
      const guardianResponse = await triggerEscapeOwner(newOwner, connect(account, [guardian]));
      await guardianResponse.wait();

      const [firstEscape] = await account.getEscape();
      expect(firstEscape.activeAt).to.be.greaterThan(0n);
      expect(firstEscape.escapeType).to.equal(ownerEscapeType);

      // TODO: do evm_increaseTime + evm_mine here when testing locally

      // owner overrides the guardian's escape
      const ownerResponse = await triggerEscapeGuardian(newGuardian, connect(account, [owner]));
      await ownerResponse.wait();

      const [secondEscape] = await account.getEscape();
      expect(secondEscape.activeAt).to.be.greaterThanOrEqual(firstEscape.activeAt); // TODO: greaterThan after evm_mine
      expect(secondEscape.escapeType).to.equal(guardianEscapeType);
    });

    it("Should forbid guardian to override a guardian escape", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      // owner triggers a guardian escape
      const response = await triggerEscapeGuardian(newGuardian, connect(account, [owner]));
      await response.wait();

      const [escape] = await account.getEscape();
      expect(escape.activeAt).to.be.greaterThan(0n);
      expect(escape.escapeType).to.equal(guardianEscapeType);

      // TODO: do evm_increaseTime + evm_mine here when testing locally

      // guardian cannot override
      const promise = triggerEscapeOwner(newOwner, connect(account, [guardian]));
      await expect(promise).to.be.rejectedWith("argent/cannot-override-escape");

      const [secondEscape] = await account.getEscape();
      expectEqualEscapes(secondEscape, {
        activeAt: escape.activeAt,
        escapeType: guardianEscapeType,
        newSigner: newGuardian.address,
      });
    });
  });

  describe("Canceling escape", () => {
    it("Should cancel an escape", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress });

      // guardian triggers a owner escape
      const response = await triggerEscapeOwner(newOwner, connect(account, [guardian]));
      await response.wait();

      const [escape] = await account.getEscape();
      expect(escape.activeAt).to.be.greaterThan(0n);
      expect(escape.escapeType).to.equal(ownerEscapeType);

      // should fail to cancel with just the owner signature
      const rejectingPromise = connect(account, [owner]).cancelEscape();
      await expect(rejectingPromise).to.be.rejectedWith("Account validation returned invalid magic value");

      const resolvingPromise = connect(account, [owner, guardian]).cancelEscape();
      await expect(resolvingPromise).to.emit(account, "EscapeCanceled");

      const [secondEscape] = await account.getEscape();
      expectEqualEscapes(secondEscape, nullEscape);
    });
  });
});
