import { expect } from "chai";
import * as zksync from "zksync-web3";
import { deployAccount } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure, EscapeType } from "../src/model";
import { deployer, guardian, guardianAddress, ownerAddress } from "./fixtures";

describe("Gas griefing", () => {
  let argent: ArgentInfrastructure;

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

  it("Should block too many triggerEscapeOwner() by guardian", async () => {
    const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [guardian] });

    for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
      const newOwner = zksync.Wallet.createRandom();
      await (await account.triggerEscapeOwner(newOwner.address)).wait();

      const [escape] = await account.getEscape();
      expect(escape.escapeType).to.equal(EscapeType.Owner);
      expect(escape.newSigner).to.equal(newOwner.address);
      await expect(account.guardianEscapeAttempts()).to.eventually.equal(attemptIndex + 1);
    }

    const newOwner = zksync.Wallet.createRandom();
    await expect(account.triggerEscapeOwner(newOwner.address)).to.be.rejectedWith("argent/max-escape-attempts");
    await expect(account.guardianEscapeAttempts()).to.eventually.equal(maxAttempts);
  });
});
