import { expect } from "chai";
import { connect, deployAccount } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure, EscapeStatus, EscapeType } from "../src/model";
import { waitForTimestamp } from "../src/provider.service";
import { changeOwnerWithSignature } from "../src/recovery.service";
import { ArgentAccount } from "../typechain-types";
import {
  deployer,
  guardian,
  guardianAddress,
  newGuardian,
  newOwner,
  other,
  owner,
  ownerAddress,
  provider,
} from "./fixtures";

describe("Recovery overrides", () => {
  let argent: ArgentInfrastructure;
  let escapeExpiryPeriod: number; // in seconds

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);

    const account = argent.implementation;
    escapeExpiryPeriod = await account.escapeExpiryPeriod();
  });

  const testAccountInStatuses = async (
    escapeType: EscapeType.Guardian | EscapeType.Owner,
    tests: Partial<Record<EscapeStatus, (account: ArgentAccount) => Promise<void>>>,
  ) => {
    const hasTestsAfter = (currentStatus: EscapeStatus) =>
      Object.keys(tests).some((status) => Number(status) > currentStatus);

    const connect = escapeType === EscapeType.Owner ? [guardian] : [owner];
    const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect, funds: "0.0005" });

    await tests[EscapeStatus.None]?.(account);
    if (!hasTestsAfter(EscapeStatus.None)) {
      return account;
    }

    const newSigner = escapeType === EscapeType.Owner ? newOwner : newGuardian;
    const triggerEscape = escapeType === EscapeType.Owner ? account.triggerEscapeOwner : account.triggerEscapeGuardian;
    const response = await triggerEscape(newSigner.address);
    await response.wait();
    await tests[EscapeStatus.NotReady]?.(account);
    if (!hasTestsAfter(EscapeStatus.NotReady)) {
      return account;
    }

    const [{ readyAt }] = await account.escapeAndStatus();
    await waitForTimestamp(readyAt, provider);
    await tests[EscapeStatus.Ready]?.(account);
    if (!hasTestsAfter(EscapeStatus.Ready)) {
      return account;
    }

    await waitForTimestamp(readyAt + escapeExpiryPeriod + 1, provider);
    await tests[EscapeStatus.Expired]?.(account);
    return account;
  };

  const deployAccountInStatus = async (
    escapeType: EscapeType.Guardian | EscapeType.Owner,
    escapeStatus: EscapeStatus,
  ) => testAccountInStatuses(escapeType, { [escapeStatus]: async () => {} });

  it("Should be in the right status", async () => {
    const expectStatus = async (account: ArgentAccount, expectedStatus: EscapeStatus) => {
      const [, actualStatus] = await account.escapeAndStatus();
      expect(actualStatus).to.equal(expectedStatus);
    };
    await testAccountInStatuses(EscapeType.Owner, {
      [EscapeStatus.None]: async (account) => expectStatus(account, EscapeStatus.None),
      [EscapeStatus.NotReady]: async (account) => expectStatus(account, EscapeStatus.NotReady),
      [EscapeStatus.Ready]: async (account) => expectStatus(account, EscapeStatus.Ready),
      [EscapeStatus.Expired]: async (account) => expectStatus(account, EscapeStatus.Expired),
    });
  });

  describe("Should cancel existing escape when calling changeSigner methods", () => {
    const changeOwner = async (account: ArgentAccount) =>
      changeOwnerWithSignature(other, connect(account, [owner, guardian]));
    const changeGuardian = async (account: ArgentAccount) =>
      connect(account, [owner, guardian]).changeGuardian(other.address);
    const changeGuardianBackup = async (account: ArgentAccount) =>
      connect(account, [owner, guardian]).changeGuardianBackup(other.address);
    const triggerEscapeGuardian = async (account: ArgentAccount) =>
      connect(account, [owner]).triggerEscapeGuardian(other.address);

    for (const changeSigner of [changeOwner, changeGuardian, changeGuardianBackup, triggerEscapeGuardian]) {
      for (const escapeType of [EscapeType.Guardian, EscapeType.Owner] as const) {
        it(`${changeSigner.name}() should cancel escapeType=${EscapeType[escapeType]} when in escapeStatus=NotReady`, async () => {
          const account = await deployAccountInStatus(escapeType, EscapeStatus.NotReady);
          await expect(changeSigner(account)).to.emit(account, "EscapeCanceled");
        });
        it(`${changeSigner.name}() should cancel escapeType=${EscapeType[escapeType]} when in escapeStatus=Ready`, async () => {
          const account = await deployAccountInStatus(escapeType, EscapeStatus.Ready);
          await expect(changeSigner(account)).to.emit(account, "EscapeCanceled");
        });
        it(`${changeSigner.name}() should clear escapeType=${EscapeType[escapeType]} when in escapeStatus=Expired`, async () => {
          const account = await deployAccountInStatus(escapeType, EscapeStatus.Expired);
          await expect(changeSigner(account)).to.not.emit(account, "EscapeCanceled");
        });
      }
    }
  });

  describe("May override existing escape when calling triggerEscapeOwner", () => {
    // owner escapes
    it(`triggerEscapeOwner() should override escapeType=Owner when in escapeStatus=NotReady`, async () => {
      const account = await deployAccountInStatus(EscapeType.Owner, EscapeStatus.NotReady);
      await expect(account.triggerEscapeOwner(other.address)).to.emit(account, "EscapeCanceled");
    });
    it(`triggerEscapeOwner() should override escapeType=Owner when in escapeStatus=Ready`, async () => {
      const account = await deployAccountInStatus(EscapeType.Owner, EscapeStatus.Ready);
      await expect(account.triggerEscapeOwner(other.address)).to.emit(account, "EscapeCanceled");
    });
    it(`triggerEscapeOwner() should override escapeType=Owner when in escapeStatus=Expired`, async () => {
      const account = await deployAccountInStatus(EscapeType.Owner, EscapeStatus.Expired);
      await expect(account.triggerEscapeOwner(other.address)).to.not.emit(account, "EscapeCanceled");
    });
    // guardian escapes
    it(`triggerEscapeOwner() should FAIL to override escapeType=Guardian when in escapeStatus=NotReady`, async () => {
      const accountFromOwner = await deployAccountInStatus(EscapeType.Guardian, EscapeStatus.NotReady);
      const account = connect(accountFromOwner, [guardian]);
      await expect(account.triggerEscapeOwner(other.address)).to.be.rejectedWith("argent/cannot-override-escape");
    });
    it(`triggerEscapeOwner() should FAIL to override escapeType=Guardian when in escapeStatus=Ready`, async () => {
      const accountFromOwner = await deployAccountInStatus(EscapeType.Guardian, EscapeStatus.Ready);
      const account = connect(accountFromOwner, [guardian]);
      await expect(account.triggerEscapeOwner(other.address)).to.be.rejectedWith("argent/cannot-override-escape");
    });
    it(`triggerEscapeOwner() should override escapeType=Guardian when in escapeStatus=Expired`, async () => {
      const accountFromOwner = await deployAccountInStatus(EscapeType.Guardian, EscapeStatus.Expired);
      const account = connect(accountFromOwner, [guardian]);
      await expect(account.triggerEscapeOwner(other.address)).to.not.emit(accountFromOwner, "EscapeCanceled");
    });
  });

  describe("Should cancel escape in any non null state", () => {
    for (const escapeType of [EscapeType.Guardian, EscapeType.Owner] as const) {
      it(`cancelEscape() should cancel escapeType=${EscapeType[escapeType]} when in escapeStatus=NotReady`, async () => {
        const account = await deployAccountInStatus(escapeType, EscapeStatus.NotReady);
        const connectedAccount = connect(account, [owner, guardian]);
        await expect(connectedAccount.cancelEscape()).to.emit(account, "EscapeCanceled");
      });
      it(`cancelEscape() should cancel escapeType=${EscapeType[escapeType]} when in escapeStatus=Ready`, async () => {
        const account = await deployAccountInStatus(escapeType, EscapeStatus.Ready);
        const connectedAccount = connect(account, [owner, guardian]);
        await expect(connectedAccount.cancelEscape()).to.emit(account, "EscapeCanceled");
      });
      it(`cancelEscape() should cancel escapeType=${EscapeType[escapeType]} when in escapeStatus=Expired`, async () => {
        const account = await deployAccountInStatus(escapeType, EscapeStatus.Expired);
        const connectedAccount = connect(account, [owner, guardian]);
        await expect(connectedAccount.cancelEscape()).to.not.emit(account, "EscapeCanceled");
      });
    }
  });

  describe("Should fail to call escape methods in invalid states", () => {
    describe("Should fail in valid escape type but invalid escape status", () => {
      const escapes = [
        ["escapeOwner", EscapeType.Owner],
        ["escapeGuardian", EscapeType.Guardian],
      ] as const;

      for (const [escapeName, escapeType] of escapes) {
        it(`${escapeName}() should FAIL with escapeType=${EscapeType[escapeType]} when in invalid statuses`, async () => {
          await testAccountInStatuses(escapeType, {
            [EscapeStatus.None]: async (account) =>
              expect(account[escapeName]()).to.be.rejectedWith("argent/invalid-escape"),
            [EscapeStatus.NotReady]: async (account) =>
              expect(account[escapeName]()).to.be.rejectedWith("argent/invalid-escape"),
            // [EscapeStatus.Ready]: // skipped
            [EscapeStatus.Expired]: async (account) =>
              expect(account[escapeName]()).to.be.rejectedWith("argent/invalid-escape"),
          });
        });
      }
    });

    describe("Should fail in invalid escape type", () => {
      const escapes = [
        ["escapeOwner", EscapeType.Guardian],
        ["escapeGuardian", EscapeType.Owner],
      ] as const;

      for (const [escapeName, escapeType] of escapes) {
        it(`${escapeName}() should FAIL with escapeType=${EscapeType[escapeType]}`, async () => {
          await testAccountInStatuses(escapeType, {
            [EscapeStatus.None]: async (account) =>
              expect(account[escapeName]()).to.be.rejectedWith("argent/invalid-escape"),
            [EscapeStatus.NotReady]: async (account) =>
              expect(account[escapeName]()).to.be.rejectedWith("argent/invalid-escape"),
            [EscapeStatus.Ready]: async (account) =>
              expect(account[escapeName]()).to.be.rejectedWith("argent/invalid-escape"),
            [EscapeStatus.Expired]: async (account) =>
              expect(account[escapeName]()).to.be.rejectedWith("argent/invalid-escape"),
          });
        });
      }
    });
  });
});
