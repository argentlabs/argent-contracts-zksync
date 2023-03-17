import { expect } from "chai";
import * as zksync from "zksync-web3";
import { deployAccount } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { waitForTimestamp } from "../src/provider.service";
import { EscapeStatus, EscapeType, triggerEscapeGuardian, triggerEscapeOwner } from "../src/recovery.service";
import { ArgentAccount } from "../typechain-types";
import { deployer, guardian, guardianAddress, owner, ownerAddress, provider } from "./fixtures";

const newOwner = zksync.Wallet.createRandom();
const newGuardian = zksync.Wallet.createRandom();

describe("Recovery statuses", () => {
  let argent: ArgentInfrastructure;
  let escapeExpiryPeriod: number; // in seconds

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);

    const account = argent.implementation;
    escapeExpiryPeriod = await account.escapeExpiryPeriod();
  });

  const expectAccountInStatuses = async (
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
  ) => expectAccountInStatuses(escapeType, { [escapeStatus]: async () => {} });

  it("Should be in the right status", async () => {
    await expectAccountInStatuses(EscapeType.Owner, {
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
});
