import { expect } from "chai";
import * as zksync from "zksync-web3";
import { Wallet } from "zksync-web3";
import { deployAccount } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure, EscapeType } from "../src/model";
import { ArgentAccount } from "../typechain-types";
import { deployer, guardian, guardianAddress, ownerAddress } from "./fixtures";

describe.only("Gas Grifing", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;

  let escapeSecurityPeriod: number; // in seconds
  let escapeExpiryPeriod: number; // in seconds
  let maxAttempts: number;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);

    const account = argent.implementation;
    escapeSecurityPeriod = await account.escapeSecurityPeriod();
    escapeExpiryPeriod = await account.escapeExpiryPeriod();
    maxAttempts = await account.MAX_ESCAPE_ATTEMPTS();
  });

  describe("Too many attempts", () => {
    it("Should block too many triggerEscapeOwner() by guardian", async () => {
      const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [guardian] });

      let newOwner: Wallet;

      for (let attemptIndex = 0; attemptIndex <= maxAttempts; attemptIndex++) {
        newOwner = zksync.Wallet.createRandom();

        await (await account.triggerEscapeOwner(newOwner.address)).wait();

        const [escape] = await account.getEscape();
        expect(escape.escapeType).to.equal(EscapeType.Owner);
        expect(escape.newSigner).to.equal(newOwner.address);
        expect(await account.guardianEscapeAttempts()).to.equal(attemptIndex + 1);
      }
      newOwner = zksync.Wallet.createRandom();
      await expect(account.triggerEscapeOwner(newOwner.address)).to.be.rejectedWith("argent/max-escape-attempts");
      expect(await account.guardianEscapeAttempts()).to.equal(maxAttempts + 1);
    });
  });
});
