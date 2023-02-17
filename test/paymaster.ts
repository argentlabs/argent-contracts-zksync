import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { BigNumber, BytesLike } from "ethers";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { PaymasterParams, TransactionRequest } from "zksync-web3/build/src/types";
import { deployAccount } from "../src/account.service";
import { CustomDeployer, getDeployer } from "../src/deployer.service";
import { deployTestDapp, getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { hashMeaningfulTransaction } from "../src/paymaster.service";
import { ArgentSigner } from "../src/signer.service";
import { ArgentAccount, TestDapp } from "../typechain-types";

const owner = zksync.Wallet.createRandom();
const guardian = zksync.Wallet.createRandom();

const ownerAddress = owner.address;
const guardianAddress = guardian.address;
const { deployer, provider } = getDeployer();

const emptyEoa = zksync.Wallet.createRandom().connect(provider);
const paymasterBudget = ethers.utils.parseEther("0.001");

describe.skip("Paymasters", () => {
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
    let allowedDapp: TestDapp;

    before(async () => {
      allowedDapp = await deployTestDapp(deployer);

      const artifact = await deployer.loadArtifact("DappWhitelistPaymaster");
      paymaster = await deployer.deploy(artifact, [[allowedDapp.address]]);

      const response = await deployer.zkWallet.sendTransaction({ to: paymaster.address, value: paymasterBudget });
      await response.wait();

      overrides = await getPaymasterOverrides(allowedDapp);
    });

    it("Should have no balance on the accounts and some balance on the paymaster", async () => {
      await expect(provider.getBalance(emptyAccount.address)).to.eventually.equal(0n);
      await expect(provider.getBalance(emptyEoa.address)).to.eventually.equal(0n);
      await expect(provider.getBalance(paymaster.address)).to.eventually.equal(paymasterBudget);
    });

    it("Should refuse to pay for dapps not on the whitelist", async () => {
      const randomDapp = await deployer.deploy(argent.artifacts.testDapp);
      await randomDapp.deployed();

      let promise = randomDapp.connect(emptyAccount.signer).setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");

      promise = emptyEoa.sendTransaction({
        to: zksync.Wallet.createRandom().address,
        value: 0,
        data: "0xdeadbeef",
        ...overrides,
      });
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");
    });

    it("Should pay for a whitelisted dapp", async () => {
      await expect(allowedDapp.userNumbers(emptyAccount.address)).to.eventually.equal(0n);
      await expect(provider.getTransactionCount(emptyAccount.address)).to.eventually.equal(0n);

      const response = await allowedDapp.connect(emptyAccount.signer).setNumber(42, overrides);
      await response.wait();

      await expect(allowedDapp.userNumbers(emptyAccount.address)).to.eventually.equal(42n);
      await expect(provider.getTransactionCount(emptyAccount.address)).to.eventually.equal(1n);
    });

    it("Should have lower balance on the paymaster and still no balance on the accounts", async () => {
      await expect(provider.getBalance(emptyAccount.address)).to.eventually.equal(0n);

      const fee = overrides.maxFeePerGas.mul(overrides.gasLimit.toString());
      await expect(provider.getBalance(paymaster.address)).to.eventually.equal(paymasterBudget.sub(fee));
    });

    it("Should update the whitelist", async () => {
      const randomDapp = await deployer.deploy(argent.artifacts.testDapp);
      await randomDapp.deployed();

      await expect(paymaster.whitelist(allowedDapp.address)).to.eventually.be.true;
      await expect(paymaster.whitelist(randomDapp.address)).to.eventually.be.false;

      // add to whitelist

      let response = await paymaster.whitelistDapp(randomDapp.address);
      await response.wait();
      await expect(paymaster.whitelist(randomDapp.address)).to.eventually.be.true;

      response = await randomDapp.connect(emptyAccount.signer).setNumber(42, overrides);
      await response.wait();

      let promise = paymaster.whitelistDapp(randomDapp.address);
      await expect(promise).to.be.rejectedWith("Already whitelisted");

      // remove from whitelist

      response = await paymaster.unwhitelistDapp(allowedDapp.address);
      await response.wait();
      await expect(paymaster.whitelist(allowedDapp.address)).to.eventually.be.false;

      promise = allowedDapp.connect(emptyAccount.signer).setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");

      promise = paymaster.unwhitelistDapp(allowedDapp.address);
      await expect(promise).to.be.rejectedWith("Not whitelisted");
    });
  });

  describe("UserWhitelistPaymaster", () => {
    let testDapp: TestDapp;

    before(async () => {
      const artifact = await deployer.loadArtifact("UserWhitelistPaymaster");
      paymaster = await deployer.deploy(artifact, [[]]);

      const response = await deployer.zkWallet.sendTransaction({ to: paymaster.address, value: paymasterBudget });
      await response.wait();

      testDapp = (await deployTestDapp(deployer)).connect(emptyAccount.signer);
      overrides = await getPaymasterOverrides(testDapp);
    });

    it("Should pay or refuse to pay for given users", async () => {
      await expect(provider.getBalance(emptyAccount.address)).to.eventually.equal(0n);
      await expect(testDapp.userNumbers(emptyAccount.address)).to.eventually.equal(0n);

      let promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");

      let response = await paymaster.whitelistUser(emptyAccount.address);
      await response.wait();

      response = await testDapp.setNumber(42, overrides);
      await response.wait();

      await expect(testDapp.userNumbers(emptyAccount.address)).to.eventually.equal(42n);

      response = await paymaster.unwhitelistUser(emptyAccount.address);
      await response.wait();

      promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");
    });
  });

  describe("SignatureCheckPaymaster", () => {
    let paymasterOwner: ArgentAccount;
    let testDapp: TestDapp;

    before(async () => {
      paymasterOwner = await deployAccount({
        argent,
        ownerAddress,
        guardianAddress,
        connect: [owner, guardian],
        funds: "0.01",
      });
      const customDeployer = new CustomDeployer(new ArgentSigner(paymasterOwner, [owner, guardian]));
      const artifact = await customDeployer.loadArtifact("SignatureCheckPaymaster");
      paymaster = await customDeployer.deploy(artifact);
      const response = await deployer.zkWallet.sendTransaction({ to: paymaster.address, value: paymasterBudget });
      await response.wait();
      await expect(paymaster.owner()).to.eventually.equal(paymasterOwner.address);

      testDapp = await deployTestDapp(deployer);
      testDapp = testDapp.connect(emptyAccount.signer);
    });

    // TODO: investigate why the revert reason doesn't bubble up like it does with EOASignatureCheckPaymaster
    it("Should refuse to pay with invalid signature", async () => {
      overrides = await getPaymasterOverrides(testDapp);
      let promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejected;

      overrides = await getPaymasterOverrides(testDapp, new Uint8Array(65));
      promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejected;

      overrides = await getPaymasterOverrides(testDapp, new Uint8Array(2 * 65));
      promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejected;

      overrides = await getPaymasterOverrides(testDapp, ethers.utils.randomBytes(65));
      promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejected;

      overrides = await getPaymasterOverrides(testDapp, ethers.utils.randomBytes(2 * 65));
      promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejected;
    });

    it("Should refuse to be owned by an EOA", async () => {
      const artifact = await deployer.loadArtifact("SignatureCheckPaymaster");
      let promise = deployer.deploy(artifact);
      await expect(promise).to.be.rejected;

      promise = paymaster.transferOwnership(emptyEoa.address);
      await expect(promise).to.be.rejectedWith("non-ERC1271 owner");
    });

    it("Should pay with a valid signature", async () => {
      overrides = await getPaymasterOverrides(testDapp);
      let transaction: TransactionRequest = await testDapp.populateTransaction.setNumber(42, {
        type: zksync.utils.EIP712_TX_TYPE,
        ...overrides,
      });
      transaction = await emptyAccount.signer.populateTransaction(transaction);

      const messageHash = hashMeaningfulTransaction(transaction);
      const signature = await paymasterOwner.signer.signMessage(ethers.utils.arrayify(messageHash));

      overrides = await getPaymasterOverrides(testDapp, signature);
      transaction = { ...transaction, ...overrides };
      const signedTransaction = await emptyAccount.signer.signTransaction(transaction);
      const response = await provider.sendTransaction(signedTransaction);
      await response.wait();

      await expect(testDapp.userNumbers(emptyAccount.address)).to.eventually.equal(42n);
    });
  });

  describe("EOASignatureCheckPaymaster", () => {
    const paymasterOwner = zksync.Wallet.createRandom();

    let testDapp: TestDapp;

    before(async () => {
      const artifact = await deployer.loadArtifact("EOASignatureCheckPaymaster");
      paymaster = await deployer.deploy(artifact);

      let response = await paymaster.transferOwnership(paymasterOwner.address);
      await response.wait();
      await expect(paymaster.owner()).to.eventually.equal(paymasterOwner.address);

      response = await deployer.zkWallet.sendTransaction({ to: paymaster.address, value: paymasterBudget });
      await response.wait();

      testDapp = await deployTestDapp(deployer);
      testDapp = testDapp.connect(emptyEoa);
    });

    it("Should refuse to pay with invalid signature", async () => {
      overrides = await getPaymasterOverrides(testDapp);
      let promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");

      overrides = await getPaymasterOverrides(testDapp, new Uint8Array(65));
      promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");

      overrides = await getPaymasterOverrides(testDapp, ethers.utils.randomBytes(65));
      promise = testDapp.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored transaction");
    });

    it("Should pay with a valid signature", async () => {
      overrides = await getPaymasterOverrides(testDapp);
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

      await expect(testDapp.userNumbers(emptyEoa.address)).to.eventually.equal(42n);
    });
  });

  describe("ArgentAccountPaymaster", () => {
    let testDapp: TestDapp;

    before(async () => {
      testDapp = await deployTestDapp(deployer);

      const artifact = await deployer.loadArtifact("ArgentAccountPaymaster");
      paymaster = await deployer.deploy(artifact, [[], []]);

      await paymaster.addCodeAndImplementationFromAccount(emptyAccount.address);
      const response = await deployer.zkWallet.sendTransaction({ to: paymaster.address, value: paymasterBudget });
      await response.wait();

      overrides = await getPaymasterOverrides(testDapp);
    });

    it("Should have no balance on the accounts and some balance on the paymaster", async () => {
      await expect(provider.getBalance(emptyAccount.address)).to.eventually.equal(0n);
      await expect(provider.getBalance(emptyEoa.address)).to.eventually.equal(0n);
      await expect(provider.getBalance(paymaster.address)).to.eventually.equal(paymasterBudget);
    });

    it("Should refuse to pay for an EOA", async () => {
      const testDappFromEoa = testDapp.connect(emptyEoa);
      const promise = testDappFromEoa.setNumber(42, overrides);
      await expect(promise).to.be.rejectedWith("Unsponsored account");
    });

    it("Should pay for an ArgentAccount", async () => {
      await expect(testDapp.userNumbers(emptyAccount.address)).to.eventually.equal(0n);

      const testDappFromArgent = testDapp.connect(emptyAccount.signer);
      const response = await testDappFromArgent.setNumber(42, overrides);
      await response.wait();

      await expect(testDapp.userNumbers(emptyAccount.address)).to.eventually.equal(42n);
    });

    it("Should have lower balance on the paymaster and still no balance on the accounts", async () => {
      await expect(provider.getBalance(emptyAccount.address)).to.eventually.equal(0n);

      const fee = overrides.maxFeePerGas.mul(overrides.gasLimit.toString());
      await expect(provider.getBalance(paymaster.address)).to.eventually.equal(paymasterBudget.sub(fee));
    });
  });
});
