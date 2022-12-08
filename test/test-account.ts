import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { PopulatedTransaction } from "ethers";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { computeCreate2AddressFromSdk, connect, deployAccount } from "../scripts/account.service";
import { checkDeployer, CustomDeployer, getDeployer } from "../scripts/deployer.service";
import { deployTestDapp, getTestInfrastructure } from "../scripts/infrastructure.service";
import { ArgentInfrastructure } from "../scripts/model";
import { ArgentSigner } from "../scripts/signer.service";
import { ArgentAccount, TestDapp } from "../typechain-types";

const { AddressZero } = ethers.constants;

const owner = zksync.Wallet.createRandom();
const guardian = zksync.Wallet.createRandom();
const newOwner = zksync.Wallet.createRandom();
const wrongOwner = zksync.Wallet.createRandom();
const wrongGuardian = zksync.Wallet.createRandom();

const ownerAddress = owner.address;
const guardianAddress = guardian.address;
const { deployer, deployerAddress, provider } = getDeployer();

describe("Argent account", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
  });

  describe("AccountFactory", () => {
    const salt = ethers.utils.randomBytes(32);

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false, salt });
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
      expect(await account.VERSION()).to.equal("0.0.1");
      expect(await account.owner()).to.equal(owner.address);
      expect(await account.guardian()).to.equal(guardian.address);
    });

    it("Should refuse to be initialized twice", async () => {
      const { abi } = argent.artifacts.implementation;
      const accountFromEoa = new zksync.Contract(account.address, abi, deployer.zkWallet);
      const promise = accountFromEoa.initialize(owner.address, guardian.address);
      await expect(promise).to.be.rejectedWith("argent/already-init");
    });
  });

  describe("Account upgrade", () => {
    let newImplementation: zksync.Contract;

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress });
      newImplementation = await deployer.deploy(argent.artifacts.implementation, [10]);
    });

    it("Should revert with the wrong owner", async () => {
      const promise = connect(account, [wrongOwner, guardian]).upgrade(newImplementation.address);
      await expect(promise).to.be.rejectedWith("argent/invalid-owner-signature");
    });

    it("Should revert with the wrong guardian", async () => {
      const promise = connect(account, [owner, wrongGuardian]).upgrade(newImplementation.address);
      await expect(promise).to.be.rejectedWith("argent/invalid-guardian-signature");
    });

    it("Should revert when new implementation isn't an IAccount", async () => {
      const promise = connect(account, [owner, guardian]).upgrade(wrongGuardian.address);
      await expect(promise).to.be.rejectedWith("argent/invalid-implementation");
    });

    it("Should upgrade the account", async () => {
      expect(await account.implementation()).to.equal(argent.implementation.address);

      const promise = connect(account, [owner, guardian]).upgrade(newImplementation.address);

      await expect(promise).to.emit(account, "AccountUpgraded").withArgs(newImplementation.address);
      expect(await account.implementation()).to.equal(newImplementation.address);
    });
  });

  describe("Transfers", () => {
    let account1: ArgentAccount;
    let account2: ArgentAccount;

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

    it("Should fund account 1 from owner key", async () => {
      const balanceBefore = await provider.getBalance(account1.address);

      const amount = ethers.utils.parseEther("0.0001");
      const response = await deployer.zkWallet.transfer({ to: account1.address, amount });
      await response.wait();

      const balanceAfter = await provider.getBalance(account1.address);
      expect(balanceAfter.sub(balanceBefore)).to.equal(amount);
    });

    it("Should transfer ETH from account 1 to account 2", async () => {
      const amount = ethers.utils.parseEther("0.00002668");
      const balanceBefore1 = await provider.getBalance(account1.address);
      const balanceBefore2 = await provider.getBalance(account2.address);

      const response = await account1.signer.sendTransaction({ to: account2.address, value: amount });
      await response.wait();

      const balanceAfter1 = await provider.getBalance(account1.address);
      const balanceAfter2 = await provider.getBalance(account2.address);

      expect(balanceBefore2).to.equal(0n);
      expect(balanceAfter1).to.be.lessThan(balanceBefore1.sub(amount)); // account for paid gas
      expect(balanceAfter2).to.equal(amount);
    });

    it("Should fail to transfer ETH from account 2 to account 1", async () => {
      const promise = connect(account2, [owner, guardian]).signer.sendTransaction({
        to: account1.address,
        value: ethers.utils.parseEther("0.00000668"),
      });

      expect(promise).to.be.rejectedWith(/transaction failed|invalid hash/);
    });
  });

  describe("Using a dapp", () => {
    let testDapp: TestDapp;

    before(async () => {
      testDapp = await deployTestDapp(deployer);
      console.log(`        TestDapp deployed to ${testDapp.address}`);
    });

    it("Should call the dapp from an EOA", async () => {
      expect(await testDapp.userNumbers(deployerAddress)).to.equal(0n);

      const response = await testDapp.setNumber(42);
      await response.wait();

      expect(await testDapp.userNumbers(deployerAddress)).to.equal(42n);
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
        await expect(dapp.setNumber(69, { nonce: 999 })).to.be.rejectedWith("Tx nonce is incorrect");
      });

      it("Should revert with bad owner", async () => {
        const { signer } = connect(account, [wrongGuardian, guardian]);
        const dapp = testDapp.connect(signer);
        await expect(dapp.setNumber(69)).to.be.rejectedWith("argent/invalid-owner-signature");
      });

      it("Should revert with bad guardian", async () => {
        const { signer } = connect(account, [owner, wrongGuardian]);
        const dapp = testDapp.connect(signer);
        await expect(dapp.setNumber(69)).to.be.rejectedWith("argent/invalid-guardian-signature");
      });

      it("Should revert with just 1 owner", async () => {
        const { signer } = connect(account, [owner]);
        const dapp = testDapp.connect(signer);
        await expect(dapp.setNumber(69)).to.be.rejectedWith("argent/invalid-guardian-signature-length");
      });

      it("Should successfully call the dapp", async () => {
        const dapp = testDapp.connect(account.signer);
        expect(await dapp.userNumbers(account.address)).to.equal(0n);

        const response = await dapp.setNumber(69);
        await response.wait();

        expect(await dapp.userNumbers(account.address)).to.equal(69n);
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
        expect(await testDapp.userNumbers(account.address)).to.equal(0n);

        const response = await testDapp.connect(account.signer).setNumber(69);
        await response.wait();

        expect(await testDapp.userNumbers(account.address)).to.equal(69n);
      });

      it("Should change the owner", async () => {
        expect(await account.owner()).to.equal(owner.address);

        const promise = account.changeOwner(newOwner.address);

        await expect(promise).to.emit(account, "OwnerChanged").withArgs(newOwner.address);
        expect(await account.owner()).to.equal(newOwner.address);
      });

      it("Should revert calls that require the guardian to be set", async () => {
        account = connect(account, [newOwner]);
        await expect(account.triggerEscapeGuardian()).to.be.rejectedWith("argent/guardian-required");
      });

      it("Should add a guardian", async () => {
        expect(await account.guardian()).to.equal(AddressZero);

        const promise = account.changeGuardian(guardian.address);

        await expect(promise).to.emit(account, "GuardianChanged").withArgs(guardian.address);
        expect(await account.guardian()).to.equal(guardian.address);
      });
    });
  });

  describe("Account multicall", () => {
    let testDapp: TestDapp;

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner, guardian] });
      testDapp = await deployTestDapp(deployer);
    });

    const makeCall = ({ to = AddressZero, data = "0x" }: PopulatedTransaction): ArgentAccount.CallStruct => ({
      to,
      value: 0,
      data,
    });

    it("Should revert when one of the calls is to the account", async () => {
      const dappCall = makeCall(await testDapp.populateTransaction.setNumber(42));
      const recoveryCall = makeCall(await account.populateTransaction.triggerEscapeGuardian());

      let promise = account.multicall([dappCall, recoveryCall]);
      await expect(promise).to.be.rejectedWith("argent/no-multicall-to-self");

      promise = account.multicall([recoveryCall, dappCall]);
      await expect(promise).to.be.rejectedWith("argent/no-multicall-to-self");
    });

    it("Should revert when one of the calls reverts", async () => {
      const dappCall = makeCall(await testDapp.populateTransaction.setNumber(42));
      const revertingCall = makeCall(await testDapp.populateTransaction.doRevert());

      let promise = account.multicall([dappCall, revertingCall]);
      await expect(promise).to.be.rejected;

      promise = account.multicall([revertingCall, dappCall]);
      await expect(promise).to.be.rejected;
    });

    it("Should successfully execute multiple calls", async () => {
      expect(await testDapp.userNumbers(account.address)).to.equal(0n);

      const response = await account.multicall([
        makeCall(await testDapp.populateTransaction.setNumber(59)),
        makeCall(await testDapp.populateTransaction.increaseNumber(10)),
      ]);
      await response.wait();

      expect(await testDapp.userNumbers(account.address)).to.equal(69n);
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
