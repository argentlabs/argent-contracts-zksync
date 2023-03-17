import { expect } from "chai";
import { connect, deployAccount } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { waitForTimestamp } from "../src/provider.service";
import { EscapeStatus, EscapeType, triggerEscapeGuardian, triggerEscapeOwner } from "../src/recovery.service";
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

describe("Recovery statuses", () => {
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
    const hasTests = (...statuses: EscapeStatus[]) => statuses.some((status) => tests[status]);
    const connect = escapeType === EscapeType.Owner ? [guardian] : [owner];
    const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect, funds: "0.0005" });

    await tests[EscapeStatus.None]?.(account);
    if (!hasTests(EscapeStatus.Triggered, EscapeStatus.Active, EscapeStatus.Expired)) {
      return account;
    }

    const newSigner = escapeType === EscapeType.Owner ? newOwner : newGuardian;
    const triggerEscape = escapeType === EscapeType.Owner ? triggerEscapeOwner : triggerEscapeGuardian;
    const response = await triggerEscape(newSigner, account);
    await response.wait();
    await tests[EscapeStatus.Triggered]?.(account);
    if (!hasTests(EscapeStatus.Active, EscapeStatus.Expired)) {
      return account;
    }

    const [{ activeAt }] = await account.getEscape();
    await waitForTimestamp(activeAt, provider);
    await tests[EscapeStatus.Active]?.(account);
    if (!hasTests(EscapeStatus.Expired)) {
      return account;
    }

    await waitForTimestamp(activeAt + escapeExpiryPeriod + 1, provider);
    await tests[EscapeStatus.Expired]?.(account);
    return account;
  };

  const deployAccountInStatus = async (
    escapeType: EscapeType.Guardian | EscapeType.Owner,
    escapeStatus: EscapeStatus,
  ) => testAccountInStatuses(escapeType, { [escapeStatus]: async () => {} });

  it("Should be in the right status", async () => {
    await testAccountInStatuses(EscapeType.Owner, {
      [EscapeStatus.None]: async (account) => {
        const [, status] = await account.getEscape();
        expect(status).to.equal(EscapeStatus.None);
      },
      [EscapeStatus.Triggered]: async (account) => {
        const [, status] = await account.getEscape();
        expect(status).to.equal(EscapeStatus.Triggered);
      },
      [EscapeStatus.Active]: async (account) => {
        const [, status] = await account.getEscape();
        expect(status).to.equal(EscapeStatus.Active);
      },
      [EscapeStatus.Expired]: async (account) => {
        const [, status] = await account.getEscape();
        expect(status).to.equal(EscapeStatus.Expired);
      },
    });
  });

  describe("Should cancel existing escape when calling changeSigner methods", () => {
    const changeOwner = async (account: ArgentAccount) =>
      connect(account, [owner, guardian]).changeOwner(other.address);
    const changeGuardian = async (account: ArgentAccount) =>
      connect(account, [owner, guardian]).changeGuardian(other.address);
    const changeGuardianBackup = async (account: ArgentAccount) =>
      connect(account, [owner, guardian]).changeGuardianBackup(other.address);
    const triggerEscapeGuardian = async (account: ArgentAccount) =>
      connect(account, [owner]).triggerEscapeGuardian(other.address);

    for (const changeSigner of [changeOwner, changeGuardian, changeGuardianBackup, triggerEscapeGuardian]) {
      for (const escapeType of [EscapeType.Guardian, EscapeType.Owner] as const) {
        for (const escapeStatus of [EscapeStatus.Triggered, EscapeStatus.Active, EscapeStatus.Expired]) {
          it(`${changeSigner.name}() should cancel escapeType=${EscapeType[escapeType]} when in escapeStatus=${EscapeStatus[escapeStatus]}`, async () => {
            const account = await deployAccountInStatus(escapeType, escapeStatus);
            expect(changeSigner(account)).to.emit(account, "EscapeCanceled");
          });
        }
      }
    }
  });

  describe("May override existing escape when calling triggerEscapeOwner", () => {
    // owner escapes
    for (const escapeStatus of [EscapeStatus.Triggered, EscapeStatus.Active, EscapeStatus.Expired]) {
      it(`triggerEscapeOwner() should override escapeType=Owner when in escapeStatus=${EscapeStatus[escapeStatus]}`, async () => {
        const account = await deployAccountInStatus(EscapeType.Owner, escapeStatus);
        expect(account.triggerEscapeOwner(other.address)).to.emit(account, "EscapeCanceled");
      });
    }
    // guardian escapes
    for (const escapeStatus of [EscapeStatus.Triggered, EscapeStatus.Active]) {
      it(`triggerEscapeOwner() should FAIL to override escapeType=Guardian when in escapeStatus=${EscapeStatus[escapeStatus]}`, async () => {
        const account = await deployAccountInStatus(EscapeType.Guardian, escapeStatus);
        expect(account.triggerEscapeOwner(other.address)).to.be.rejectedWith("argent/cannot-override-escape");
      });
    }
    it(`triggerEscapeOwner() should override escapeType=Owner when in escapeStatus=Expired`, async () => {
      const account = await deployAccountInStatus(EscapeType.Guardian, EscapeStatus.Expired);
      expect(account.triggerEscapeOwner(other.address)).to.emit(account, "EscapeCanceled");
    });
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
              expect(account[escapeName](other.address)).to.be.rejectedWith("argent/inactive-escape"),
            [EscapeStatus.Triggered]: async (account) =>
              expect(account[escapeName](other.address)).to.be.rejectedWith("argent/inactive-escape"),
            // [EscapeStatus.Active]: // skipped
            [EscapeStatus.Expired]: async (account) =>
              expect(account[escapeName](other.address)).to.be.rejectedWith("argent/inactive-escape"),
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
              expect(account[escapeName](other.address)).to.be.rejectedWith("argent/inactive-escape"),
            [EscapeStatus.Triggered]: async (account) =>
              expect(account[escapeName](other.address)).to.be.rejectedWith("argent/inactive-escape"),
            [EscapeStatus.Active]: async (account) =>
              expect(account[escapeName](other.address)).to.be.rejectedWith("argent/invalid-escape-type"),
            [EscapeStatus.Expired]: async (account) =>
              expect(account[escapeName](other.address)).to.be.rejectedWith("argent/inactive-escape"),
          });
        });
      }
    });
  });
});
