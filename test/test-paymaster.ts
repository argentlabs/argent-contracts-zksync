import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { BigNumber, BytesLike } from "ethers";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { PaymasterParams, TransactionRequest } from "zksync-web3/build/src/types";
import { ArgentAccount, deployAccount } from "../scripts/account.service";
import { getDeployer } from "../scripts/deployer.service";
import { getTestInfrastructure } from "../scripts/infrastructure.service";
import { ArgentInfrastructure } from "../scripts/model";
import { hashMeaningfulTransaction } from "../scripts/paymaster.service";

const owner = zksync.Wallet.createRandom();
const guardian = zksync.Wallet.createRandom();

const ownerAddress = owner.address;
const guardianAddress = guardian.address;
const { deployer, provider } = getDeployer();

const emptyEoa = zksync.Wallet.createRandom().connect(provider);
const paymasterBudget = ethers.utils.parseEther("0.001");

describe("Paymasters", () => {
  let argent: ArgentInfrastructure;
  let emptyAccount: ArgentAccount;
  let paymaster: zksync.Contract;

  let overrides: TransactionRequest & { gasLimit: BigNumber; maxFeePerGas: BigNumber };

  before(async () => {
    argent = await getTestInfrastructure(deployer);
    emptyAccount = await deployAccount({
      argent,
      ownerAddress,
      guardianAddress,
      funds: false,
      connect: [owner, guardian],
    });
  });

  const getPaymasterOverrides = async (
    testDapp: zksync.Contract,
    innerInput: BytesLike = "0x",
  ): Promise<typeof overrides> => {
    let paymasterParams: PaymasterParams = { paymaster: paymaster.address, paymasterInput: "0x" };
    const gasLimit = await testDapp.estimateGas.setNumber(42, { customData: { paymasterParams } });

    paymasterParams = zksync.utils.getPaymasterParams(paymaster.address, { type: "General", innerInput });
    const gasPrice = await provider.getGasPrice();
    return {
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
      gasLimit,
      customData: { paymasterParams },
    };
  };

  describe("DappWhitelistPaymaster", () => {
    let allowedDapp: zksync.Contract;

    before(async () => {
      allowedDapp = await deployer.deploy(argent.artifacts.testDapp);

      const artifact = await deployer.loadArtifact("DappWhitelistPaymaster");
      paymaster = await deployer.deploy(artifact, [[allowedDapp.address]]);

      const response = await deployer.zkWallet.sendTransaction({ to: paymaster.address, value: paymasterBudget });
      await response.wait();

      overrides = await getPaymasterOverrides(allowedDapp);
    });

    it("Should have no balance on the accounts and some balance on the paymaster", async () => {
      expect(await provider.getBalance(emptyAccount.address)).to.equal(0n);
      expect(await provider.getBalance(emptyEoa.address)).to.equal(0n);
      expect(await provider.getBalance(paymaster.address)).to.equal(paymasterBudget);
    });

    it("Should refuse to pay for dapps not on the whitelist", async () => {
      const randomDapp = await deployer.deploy(argent.artifacts.testDapp);
      await randomDapp.deployed();

      let promise = randomDapp.connect(emptyAccount.signer).setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");

      promise = emptyEoa.sendTransaction({
        to: zksync.Wallet.createRandom().address,
        value: 69,
        data: "0x",
        ...overrides,
      });
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");
    });

    it("Should pay for a whitelisted dapp", async () => {
      expect(await allowedDapp.userNumbers(emptyAccount.address)).to.equal(0n);
      expect(await provider.getTransactionCount(emptyAccount.address)).to.equal(0n);

      const response = await allowedDapp.connect(emptyAccount.signer).setNumber(42, overrides);
      await response.wait();

      expect(await allowedDapp.userNumbers(emptyAccount.address)).to.equal(42n);
      expect(await provider.getTransactionCount(emptyAccount.address)).to.equal(1n);
    });

    it("Should have lower balance on the paymaster and still no balance on the accounts", async () => {
      expect(await provider.getBalance(emptyAccount.address)).to.equal(0n);

      const fee = overrides.maxFeePerGas.mul(overrides.gasLimit.toString());
      expect(await provider.getBalance(paymaster.address)).to.equal(paymasterBudget.sub(fee));
    });

    it("Should update the whitelist", async () => {
      const randomDapp = await deployer.deploy(argent.artifacts.testDapp);
      await randomDapp.deployed();

      expect(await paymaster.whitelist(allowedDapp.address)).to.be.true;
      expect(await paymaster.whitelist(randomDapp.address)).to.be.false;

      // add to whitelist

      let response = await paymaster.whitelistDapp(randomDapp.address);
      await response.wait();
      expect(await paymaster.whitelist(randomDapp.address)).to.be.true;

      response = await randomDapp.connect(emptyAccount.signer).setNumber(42, overrides);
      await response.wait();

      let promise = paymaster.whitelistDapp(randomDapp.address);
      await expect(promise).to.be.rejectedWith("Already whitelisted");

      // remove from whitelist

      response = await paymaster.unwhitelistDapp(allowedDapp.address);
      await response.wait();
      expect(await paymaster.whitelist(allowedDapp.address)).to.be.false;

      promise = allowedDapp.connect(emptyAccount.signer).setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");

      promise = paymaster.unwhitelistDapp(allowedDapp.address);
      await expect(promise).to.be.rejectedWith("Not whitelisted");
    });
  });

  describe("UserWhitelistPaymaster", () => {
    let testDapp: zksync.Contract;

    before(async () => {
      const artifact = await deployer.loadArtifact("UserWhitelistPaymaster");
      paymaster = await deployer.deploy(artifact, [[]]);

      const response = await deployer.zkWallet.sendTransaction({ to: paymaster.address, value: paymasterBudget });
      await response.wait();

      testDapp = (await deployer.deploy(argent.artifacts.testDapp)).connect(emptyAccount.signer);
      overrides = await getPaymasterOverrides(testDapp);
    });

    it("Should pay or refuse to pay for given users", async () => {
      expect(await provider.getBalance(emptyAccount.address)).to.equal(0n);
      expect(await testDapp.userNumbers(emptyAccount.address)).to.equal(0n);

      let promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");

      let response = await paymaster.whitelistUser(emptyAccount.address);
      await response.wait();

      response = await testDapp.setNumber(42, overrides);
      await response.wait();

      expect(await testDapp.userNumbers(emptyAccount.address)).to.equal(42n);

      response = await paymaster.unwhitelistUser(emptyAccount.address);
      await response.wait();

      promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");
    });
  });

  describe("SignatureCheckPaymaster", () => {
    // wait to be able to deploy from contract accounts
  });

  describe("EOASignatureCheckPaymaster", () => {
    const paymasterOwner = zksync.Wallet.createRandom();

    let testDapp: zksync.Contract;

    before(async () => {
      const artifact = await deployer.loadArtifact("EOASignatureCheckPaymaster");
      paymaster = await deployer.deploy(artifact);

      let response = await paymaster.changeOwner(paymasterOwner.address);
      await response.wait();
      expect(await paymaster.owner()).to.equal(paymasterOwner.address);

      response = await deployer.zkWallet.sendTransaction({ to: paymaster.address, value: paymasterBudget });
      await response.wait();

      testDapp = await deployer.deploy(argent.artifacts.testDapp);
    });

    it("Should pay or no for given users", async () => {
      testDapp = testDapp.connect(emptyEoa);

      overrides = await getPaymasterOverrides(testDapp);
      let promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("invalid signature length");

      overrides = await getPaymasterOverrides(testDapp, new Uint8Array(65));
      promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("ECDSA: invalid signature");

      overrides = await getPaymasterOverrides(testDapp, ethers.utils.randomBytes(65));
      promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("ECDSA: invalid signature");

      let transaction: TransactionRequest = await testDapp.populateTransaction.setNumber(42, {
        type: zksync.utils.EIP712_TX_TYPE,
        ...overrides,
      });
      transaction = await emptyEoa.populateTransaction(transaction);

      const messageHash = hashMeaningfulTransaction(transaction);
      const signature = await paymasterOwner.signMessage(ethers.utils.arrayify(messageHash));

      overrides = await getPaymasterOverrides(testDapp, signature);
      transaction = { ...transaction, ...overrides };
      const signedTransaction = await emptyEoa.signTransaction(transaction);
      const response = await provider.sendTransaction(signedTransaction);
      await response.wait();

      expect(await testDapp.userNumbers(emptyEoa.address)).to.equal(42n);
    });
  });

  describe("ArgentAccountPaymaster", () => {
    let testDapp: zksync.Contract;

    before(async () => {
      testDapp = await deployer.deploy(argent.artifacts.testDapp);

      const artifact = await deployer.loadArtifact("ArgentAccountPaymaster");
      paymaster = await deployer.deploy(artifact, [[], []]);

      await paymaster.addCodeAndImplementationFromAccount(emptyAccount.address);
      const response = await deployer.zkWallet.sendTransaction({ to: paymaster.address, value: paymasterBudget });
      await response.wait();

      overrides = await getPaymasterOverrides(testDapp);
    });

    it("Should have no balance on the accounts and some balance on the paymaster", async () => {
      expect(await provider.getBalance(emptyAccount.address)).to.equal(0n);
      expect(await provider.getBalance(emptyEoa.address)).to.equal(0n);
      expect(await provider.getBalance(paymaster.address)).to.equal(paymasterBudget);
    });

    it("Should refuse to pay for an EOA", async () => {
      const testDappFromEoa = testDapp.connect(emptyEoa);
      const promise = testDappFromEoa.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored account");
    });

    it("Should pay for an ArgentAccount", async () => {
      expect(await testDapp.userNumbers(emptyAccount.address)).to.equal(0n);

      const testDappFromArgent = testDapp.connect(emptyAccount.signer);
      const response = await testDappFromArgent.setNumber(42, overrides);
      await response.wait();

      expect(await testDapp.userNumbers(emptyAccount.address)).to.equal(42n);
    });

    it("Should have lower balance on the paymaster and still no balance on the accounts", async () => {
      expect(await provider.getBalance(emptyAccount.address)).to.equal(0n);

      const fee = overrides.maxFeePerGas.mul(overrides.gasLimit.toString());
      expect(await provider.getBalance(paymaster.address)).to.equal(paymasterBudget.sub(fee));
    });
  });
});
