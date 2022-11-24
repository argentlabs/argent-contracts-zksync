import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import * as zksync from "zksync-web3";
import { ArgentAccount, deployAccount, logBalance } from "../scripts/account.service";
import { checkDeployerBalance, getDeployer } from "../scripts/deployer.service";
import { deployPaymaster } from "../scripts/paymaster.service";
import { deployInfrastructure, getTestInfrastructure } from "../scripts/infrastructure.service";
import { ArgentInfrastructure } from "../scripts/model";

const owner = zksync.Wallet.createRandom();
const guardian = zksync.Wallet.createRandom();

const ownerAddress = owner.address;
const guardianAddress = guardian.address;
const { deployer, provider } = getDeployer();

describe("Paymasters", () => {
  let argent: ArgentInfrastructure;

  let account: ArgentAccount;
  let paymaster: zksync.Contract;

  before(async () => {
    argent = await getTestInfrastructure(deployer);
  });

  describe("SponsoringPaymaster", () => {
    before(async () => {
      account = await deployAccount({
        argent,
        ownerAddress,
        guardianAddress,
        funds: false,
        connect: [owner, guardian],
      });
      paymaster = await deployPaymaster(argent);
    });

    it("Should have no balance on the account and some balance on the paymaster", async () => {
      const accountBalance = await provider.getBalance(account.address);
      await logBalance(account.address, accountBalance, "Account");
      expect(accountBalance).to.equal(0n);

      const paymasterBalance = await provider.getBalance(paymaster.address);
      await logBalance(paymaster.address, paymasterBalance, "Paymaster");
      expect(paymasterBalance).to.be.greaterThan(0n);
    });

    it("Should refuse to pay for an EOA", async () => {});
  });
});
