import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import * as zksync from "zksync-web3";
import { PaymasterParams, TransactionRequest } from "zksync-web3/build/src/types";
import { ArgentAccount, deployAccount } from "../scripts/account.service";
import { getDeployer } from "../scripts/deployer.service";
import { getTestInfrastructure } from "../scripts/infrastructure.service";
import { ArgentInfrastructure } from "../scripts/model";
import { deployPaymaster } from "../scripts/paymaster.service";

const owner = zksync.Wallet.createRandom();
const guardian = zksync.Wallet.createRandom();

const ownerAddress = owner.address;
const guardianAddress = guardian.address;
const { deployer, provider } = getDeployer();

describe("Paymasters", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;
  let paymaster: zksync.Contract;
  let testDapp: zksync.Contract;

  before(async () => {
    argent = await getTestInfrastructure(deployer);
    ({ testDapp } = argent);
  });

  describe("SponsoringPaymaster", () => {
    let paymasterInitialBalance: BigNumber;
    let gasLimit: BigNumber;
    let gasPrice: BigNumber;
    let options: TransactionRequest;

    before(async () => {
      account = await deployAccount({
        argent,
        ownerAddress,
        guardianAddress,
        funds: false,
        connect: [owner, guardian],
      });
      paymaster = await deployPaymaster(argent);
      paymasterInitialBalance = await provider.getBalance(paymaster.address);

      let paymasterParams: PaymasterParams = { paymaster: paymaster.address, paymasterInput: "0x" };
      gasLimit = await testDapp.estimateGas.setNumber(42, { customData: { paymasterParams } });

      paymasterParams = zksync.utils.getPaymasterParams(paymaster.address, { type: "General", innerInput: "0x" });
      gasPrice = await provider.getGasPrice();
      options = {
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        gasLimit,
        customData: { paymasterParams },
      };
    });

    it("Should have no balance on the accounts and some balance on the paymaster", async () => {
      expect(await provider.getBalance(account.address)).to.equal(0n);
      expect(await provider.getBalance(owner.address)).to.equal(0n);

      expect(paymasterInitialBalance).to.be.greaterThan(0n);
    });

    it("Should refuse to pay for an EOA", async () => {
      const testDappFromEoa = testDapp.connect(owner.connect(provider));
      const promise = testDappFromEoa.setNumber(42, options);
      await expect(promise).to.be.rejectedWith("Unsponsored account");
    });

    it("Should pay for an ArgentAccount", async () => {
      expect(await testDapp.userNumbers(account.address)).to.equal(0n);

      const testDappFromArgent = testDapp.connect(account.signer);
      const response = await testDappFromArgent.setNumber(42, options);
      await response.wait();

      expect(await testDapp.userNumbers(account.address)).to.equal(42n);
    });

    it("Should have lower balance the paymaster and still no balance on the accounts", async () => {
      const newAccountBalance = await provider.getBalance(account.address);
      expect(newAccountBalance).to.equal(0n);

      const newPaymasterBalance = await provider.getBalance(paymaster.address);
      expect(newPaymasterBalance).to.be.lessThan(paymasterInitialBalance);

      const fee = gasPrice.mul(gasLimit.toString());
      expect(newPaymasterBalance).to.equal(paymasterInitialBalance.sub(fee));
    });
  });
});
