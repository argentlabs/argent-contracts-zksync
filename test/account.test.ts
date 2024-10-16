import { expect } from "chai";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import {
  argentAccountAt,
  computeCreate2AddressFromSdk,
  connect,
  deployAccount,
  deployProxyAccount,
} from "../src/account.service";
import { CustomDeployer, checkDeployer } from "../src/deployer.service";
import { deployTestDapp, getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { changeOwnerWithSignature } from "../src/recovery.service";
import { ArgentSigner } from "../src/signer.service";
import { ArgentAccount, TestDapp } from "../typechain-types";
import {
  AddressZero,
  deployer,
  deployerAddress,
  guardian,
  guardianAddress,
  newGuardian,
  newOwner,
  owner,
  ownerAddress,
  provider,
  wrongGuardian,
} from "./fixtures";

describe("Argent account", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
  });

  describe("AccountFactory", () => {
    const salt = ethers.utils.randomBytes(32);

    it("Should deploy an account", async () => {
      const response = await deployProxyAccount({ argent, ownerAddress, guardianAddress, salt });
      const [{ deployedAddress }] = zksync.utils.getDeployedContracts(await response.wait());
      account = argentAccountAt(deployedAddress, argent);
      await expect(response).to.emit(account, "AccountCreated").withArgs(ownerAddress, guardianAddress);
    });

    it("Should predict the account address from the JS SDK", async () => {
      const address = computeCreate2AddressFromSdk(argent, salt, ownerAddress, guardianAddress);
      expect(account.address).to.equal(address);
    });

    it("Should predict the account address from the factory contract", async () => {
      const address = await argent.factory.computeCreate2Address(
        salt,
        argent.implementation.address,
        ownerAddress,
        guardianAddress,
      );
      expect(account.address).to.equal(address);
    });

    it("Should be initialized properly", async () => {
      const implementationVersion = await argent.implementation.version();
      const accountVersion = await account.version();
      expect(accountVersion).to.deep.equal(implementationVersion);
      await expect(account.owner()).to.eventually.equal(ownerAddress);
      await expect(account.guardian()).to.eventually.equal(guardianAddress);
      await expect(account.guardianBackup()).to.eventually.equal(AddressZero);
    });

    it("Should refuse to be initialized twice", async () => {
      const { abi } = argent.artifacts.implementation;
      const accountFromEoa = new zksync.Contract(account.address, abi, deployer.zkWallet);
      const promise = accountFromEoa.initialize(ownerAddress, guardianAddress);
      await expect(promise).to.be.rejectedWith("argent/already-init");
    });
  });

  describe("Transfers", () => {
    let account1: ArgentAccount;
    let account2: ArgentAccount;

    const eoa = zksync.Wallet.createRandom();

    it("Should deploy a new account (1)", async () => {
      const connect = [owner, guardian];
      account1 = await deployAccount({ argent, ownerAddress, guardianAddress, connect, funds: false });
      console.log(`        Account 1 deployed to ${account1.address}`);
    });

    it("Should deploy a new account (2)", async () => {
      const ownerAddress = "0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8";
      account2 = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
      console.log(`        Account 2 deployed to ${account2.address}`);
    });

    it("Should transfer ETH from EOA to account 1", async () => {
      const balanceBefore = await provider.getBalance(account1.address);
      const value = ethers.utils.parseEther("0.008");
      const response = await deployer.zkWallet.sendTransaction({ to: account1.address, value });
      await response.wait();

      const balanceAfter = await provider.getBalance(account1.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(value);
    });

    it("Should transfer ETH from account 1 to account 2", async () => {
      const balanceBefore1 = await provider.getBalance(account1.address);
      const balanceBefore2 = await provider.getBalance(account2.address);
      expect(balanceBefore2).to.equal(0n);

      const value = 42;
      const response = await account1.signer.sendTransaction({ to: account2.address, value });
      await expect(response).to.emit(account1, "TransactionExecuted").withArgs(response.hash, "0x");

      const balanceAfter1 = await provider.getBalance(account1.address);
      const balanceAfter2 = await provider.getBalance(account2.address);
      expect(balanceAfter1).to.be.lessThan(balanceBefore1.sub(value)); // account for paid gas
      expect(balanceAfter2).to.equal(value);
    });

    it("Should transfer ETH from account 1 to an EOA", async () => {
      const balanceBefore1 = await provider.getBalance(account1.address);

      const value = 69;
      const response = await account1.signer.sendTransaction({ to: eoa.address, value });
      await response.wait();

      const balanceAfter1 = await provider.getBalance(account1.address);
      expect(balanceAfter1).to.be.lessThanOrEqual(balanceBefore1.sub(value)); // account for paid gas
    });

    it("Should transfer ETH from an EOA to another EOA", async () => {
      const value = 72;
      const response = await deployer.zkWallet.sendTransaction({ to: eoa.address, value });
      await response.wait();
    });

    it("Should fail to transfer ETH from account 2 to account 1", async () => {
      const promise = connect(account2, [owner, guardian]).signer.sendTransaction({
        to: account1.address,
        value: 1,
      });

      await expect(promise).to.be.rejectedWith(/Not enough balance|insufficient funds/i);
    });
  });

  describe("Using a dapp", () => {
    let testDapp: TestDapp;

    before(async () => {
      testDapp = await deployTestDapp(deployer);
      console.log(`        TestDapp deployed to ${testDapp.address}`);
    });

    it("Should call the dapp from an EOA", async () => {
      await expect(testDapp.userNumbers(deployerAddress)).to.eventually.equal(0n);

      const response = await testDapp.setNumber(42);
      await response.wait();

      await expect(testDapp.userNumbers(deployerAddress)).to.eventually.equal(42n);
    });

    describe("Calling the dapp using a guardian", () => {
      before(async () => {
        account = await deployAccount({
          argent,
          ownerAddress,
          guardianAddress,
          connect: [owner, guardian],
          funds: "0.001",
        });
      });

      it("Should revert with bad nonce", async () => {
        const dapp = testDapp.connect(account.signer);
        await expect(dapp.setNumber(69, { nonce: 999 })).to.be.rejectedWith("nonce too high");
      });

      it("Should revert with bad owner", async () => {
        const { signer } = connect(account, [wrongGuardian, guardian]);
        const dapp = testDapp.connect(signer);
        await expect(dapp.setNumber(69)).to.be.rejectedWith("Account validation returned invalid magic value");
      });

      it("Should revert with bad guardian", async () => {
        const { signer } = connect(account, [owner, wrongGuardian]);
        const dapp = testDapp.connect(signer);
        await expect(dapp.setNumber(69)).to.be.rejectedWith("Account validation returned invalid magic value");
      });

      it("Should revert with just owner", async () => {
        const { signer } = connect(account, [owner]);
        const dapp = testDapp.connect(signer);
        await expect(dapp.setNumber(69)).to.be.rejectedWith("Account validation returned invalid magic value");
      });

      it("Should successfully call the dapp", async () => {
        const dapp = testDapp.connect(account.signer);
        await expect(dapp.userNumbers(account.address)).to.eventually.equal(0n);

        const response = await dapp.setNumber(69);
        await response.wait();

        await expect(dapp.userNumbers(account.address)).to.eventually.equal(69n);
      });
    });

    describe("Calling the dapp without using a guardian", () => {
      before(async () => {
        account = await deployAccount({
          argent,
          ownerAddress,
          guardianAddress: AddressZero,
          connect: [owner],
          funds: "0.01",
        });
      });

      it("Should successfully call the dapp", async () => {
        await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);

        const response = await testDapp.connect(account.signer).setNumber(69);
        await response.wait();

        await expect(testDapp.userNumbers(account.address)).to.eventually.equal(69n);
      });

      it("Should change the owner", async () => {
        await expect(account.owner()).to.eventually.equal(owner.address);

        const promise = changeOwnerWithSignature(newOwner, account);

        await expect(promise).to.emit(account, "OwnerChanged").withArgs(newOwner.address);
        await expect(account.owner()).to.eventually.equal(newOwner.address);
      });

      it("Should revert calls that require the guardian to be set", async () => {
        account = connect(account, [newOwner]);
        await expect(account.triggerEscapeGuardian(newGuardian.address)).to.be.rejectedWith("argent/guardian-required");
      });

      it("Should add a guardian", async () => {
        await expect(account.guardian()).to.eventually.equal(AddressZero);

        const promise = account.changeGuardian(guardian.address);

        await expect(promise).to.emit(account, "GuardianChanged").withArgs(guardian.address);
        await expect(account.guardian()).to.eventually.equal(guardian.address);
      });
    });
  });

  describe("Deploying contracts from account", () => {
    before(async () => {
      account = await deployAccount({
        argent,
        ownerAddress,
        guardianAddress,
        connect: [owner, guardian],
        funds: "0.01",
      });
    });

    it("Should deploy a contract from the account", async () => {
      const balanceBefore = await provider.getBalance(account.address);

      const customDeployer = new CustomDeployer(new ArgentSigner(account, [owner, guardian]));
      const testDapp = await customDeployer.deploy(argent.artifacts.testDapp);

      const response = await testDapp.setNumber(52);
      await response.wait();

      const balanceAfter = await provider.getBalance(account.address);
      expect(balanceAfter).to.be.lessThan(balanceBefore);
    });
  });
});
