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
import { ArgentAccount, TestDapp, UpgradedArgentAccount } from "../typechain-types";

const { AddressZero } = ethers.constants;

const owner = zksync.Wallet.createRandom();
const guardian = zksync.Wallet.createRandom();
const newOwner = zksync.Wallet.createRandom();
const wrongOwner = zksync.Wallet.createRandom();
const wrongGuardian = zksync.Wallet.createRandom();

const ownerAddress = owner.address;
const guardianAddress = guardian.address;
const { deployer, deployerAddress, provider } = getDeployer();

console.log(`owner private key: ${owner.privateKey} (${ownerAddress})`);
console.log(`guardian private key: ${guardian.privateKey} (${guardianAddress})`);

const makeCall = ({ to = AddressZero, data = "0x" }: PopulatedTransaction): ArgentAccount.CallStruct => ({
  to,
  value: 0,
  data,
});

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
      const version = new Uint8Array(32);
      version.set(ethers.utils.toUtf8Bytes("0.0.1"));
      await expect(account.VERSION()).to.eventually.equal(ethers.utils.hexlify(version));
      await expect(account.owner()).to.eventually.equal(owner.address);
      await expect(account.guardian()).to.eventually.equal(guardian.address);
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
      account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: "0.0005" });
      newImplementation = await deployer.deploy(argent.artifacts.implementation, [10]);
    });

    it("Should revert with the wrong owner", async () => {
      const promise = connect(account, [wrongOwner, guardian]).upgrade(newImplementation.address, "0x");
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");
    });

    it("Should revert with the wrong guardian", async () => {
      const promise = connect(account, [owner, wrongGuardian]).upgrade(newImplementation.address, "0x");
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");
    });

    it("Should revert when new implementation isn't an IAccount", async () => {
      const promise = connect(account, [owner, guardian]).upgrade(wrongGuardian.address, "0x");
      // await expect(promise).to.be.rejectedWith("argent/invalid-implementation");
      await expect(promise).to.be.rejected;
    });

    it("Should revert when calling upgrade callback directly", async () => {
      const version = await account.VERSION();
      const promise = connect(account, [owner, guardian]).executeAfterUpgrade(version, "0x");
      await expect(promise).to.be.rejectedWith("Account validation returned invalid magic value");
    });

    it("Should revert when calling upgrade callback via multicall", async () => {
      const version = await account.VERSION();
      const call = makeCall(await account.populateTransaction.executeAfterUpgrade(version, "0x"));
      const promise = connect(account, [owner, guardian]).multicall([call]);
      // await expect(promise).to.be.rejectedWith("argent/no-multicall-to-self");
      await expect(promise).to.be.rejected;
    });

    it("Should upgrade the account", async () => {
      await expect(account.implementation()).to.eventually.equal(argent.implementation.address);

      const promise = connect(account, [owner, guardian]).upgrade(newImplementation.address, "0x");

      await expect(promise).to.emit(account, "AccountUpgraded").withArgs(newImplementation.address);
      await expect(account.implementation()).to.eventually.equal(newImplementation.address);
    });

    it("Should upgrade the account and run the callback", async () => {
      account = await deployAccount({
        argent,
        ownerAddress,
        guardianAddress,
        funds: "0.0005",
        connect: [owner, guardian],
      });

      const artifact = await deployer.loadArtifact("UpgradedArgentAccount");
      const newImplementation = await deployer.deploy(artifact, [10]);
      const upgradedAccount = new zksync.Contract(
        account.address,
        artifact.abi,
        account.provider,
      ) as UpgradedArgentAccount;

      await expect(upgradedAccount.newStorage()).to.be.reverted;

      const promise = account.upgrade(newImplementation.address, "0x");
      // await expect(promise).to.be.rejectedWith("argent/upgrade-callback-failed");
      await expect(promise).to.be.rejected;

      const value = 42;
      const data = new ethers.utils.AbiCoder().encode(["uint256"], [value]);

      const response = await account.upgrade(newImplementation.address, data);
      await response.wait();

      await expect(upgradedAccount.newStorage()).to.eventually.equal(value);
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
      const value = ethers.utils.parseEther("0.001");
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
      await response.wait();

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

        const promise = account.changeOwner(newOwner.address);

        await expect(promise).to.emit(account, "OwnerChanged").withArgs(newOwner.address);
        await expect(account.owner()).to.eventually.equal(newOwner.address);
      });

      it("Should revert calls that require the guardian to be set", async () => {
        account = connect(account, [newOwner]);
        // await expect(account.triggerEscapeGuardian()).to.be.rejectedWith("argent/guardian-required");
        await expect(account.triggerEscapeGuardian()).to.be.rejected;
      });

      it("Should add a guardian", async () => {
        await expect(account.guardian()).to.eventually.equal(AddressZero);

        const promise = account.changeGuardian(guardian.address);

        await expect(promise).to.emit(account, "GuardianChanged").withArgs(guardian.address);
        await expect(account.guardian()).to.eventually.equal(guardian.address);
      });
    });
  });

  describe("Account multicall", () => {
    let testDapp: TestDapp;

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner, guardian] });
      testDapp = await deployTestDapp(deployer);
    });

    it("Should revert when one of the calls is to the account", async () => {
      const dappCall = makeCall(await testDapp.populateTransaction.setNumber(42));
      const recoveryCall = makeCall(await account.populateTransaction.triggerEscapeGuardian());

      let promise = account.multicall([dappCall, recoveryCall]);
      // await expect(promise).to.be.rejectedWith("argent/no-multicall-to-self");
      await expect(promise).to.be.rejected;

      promise = account.multicall([recoveryCall, dappCall]);
      // await expect(promise).to.be.rejectedWith("argent/no-multicall-to-self");
      await expect(promise).to.be.rejected;
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
      await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);

      const response = await account.multicall([
        makeCall(await testDapp.populateTransaction.setNumber(59)),
        makeCall(await testDapp.populateTransaction.increaseNumber(10)),
      ]);
      await response.wait();

      await expect(testDapp.userNumbers(account.address)).to.eventually.equal(69n);
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
