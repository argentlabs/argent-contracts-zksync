import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { PopulatedTransaction } from "ethers";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount, computeCreate2AddressFromSdk, deployAccount } from "../scripts/account.service";
import { checkDeployer, getDeployer } from "../scripts/deployer.service";
import { getTestInfrastructure } from "../scripts/infrastructure.service";
import { ArgentArtifacts, ArgentInfrastructure } from "../scripts/model";

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
  let artifacts: ArgentArtifacts;
  let implementation: zksync.Contract;
  let account: ArgentAccount;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
    ({ artifacts, implementation, dummyAccount: account } = argent);
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
        implementation.address,
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
      const accountFromEoa = new zksync.Contract(account.address, artifacts.implementation.abi, deployer.zkWallet);
      const promise = accountFromEoa.initialize(owner.address, guardian.address);
      await expect(promise).to.be.rejectedWith("argent/already-init");
    });
  });

  describe("Account upgrade", () => {
    let newImplementation: zksync.Contract;

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress });
      newImplementation = await deployer.deploy(artifacts.implementation, [10]);
    });

    it("Should revert with the wrong owner", async () => {
      const promise = account.connect([wrongOwner, guardian]).upgrade(newImplementation.address);
      await expect(promise).to.be.rejectedWith("argent/invalid-owner-signature");
    });

    it("Should revert with the wrong guardian", async () => {
      const promise = account.connect([owner, wrongGuardian]).upgrade(newImplementation.address);
      await expect(promise).to.be.rejectedWith("argent/invalid-guardian-signature");
    });

    it("Should revert when new implementation isn't an IAccount", async () => {
      const promise = account.connect([owner, guardian]).upgrade(wrongGuardian.address);
      await expect(promise).to.be.rejectedWith("argent/invalid-implementation");
    });

    it("Should upgrade the account", async () => {
      expect(await account.implementation()).to.equal(implementation.address);

      const promise = account.connect([owner, guardian]).upgrade(newImplementation.address);

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
      const promise = account2.connect([owner, guardian]).signer.sendTransaction({
        to: account1.address,
        value: ethers.utils.parseEther("0.00000668"),
      });

      expect(promise).to.be.rejectedWith(/transaction failed|invalid hash/);
    });
  });

  describe("Using a dapp", () => {
    let testDapp: zksync.Contract;

    before(async () => {
      testDapp = await deployer.deploy(artifacts.testDapp);
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
        const dapp = testDapp.connect(account.connect([wrongGuardian, guardian]).signer);
        await expect(dapp.setNumber(69)).to.be.rejectedWith("argent/invalid-owner-signature");
      });

      it("Should revert with bad guardian", async () => {
        const dapp = testDapp.connect(account.connect([owner, wrongGuardian]).signer);
        await expect(dapp.setNumber(69)).to.be.rejectedWith("argent/invalid-guardian-signature");
      });

      it("Should revert with just 1 owner", async () => {
        const dapp = testDapp.connect(account.connect([owner]).signer);
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
          funds: "0.01000",
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
        account = account.connect([newOwner]);
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
    let testDapp: zksync.Contract;

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner, guardian] });
      testDapp = await deployer.deploy(artifacts.testDapp);
    });

    const makeCall = ({ to, data }: PopulatedTransaction) => ({ to, value: 0, data });

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

  describe.skip("Deploying contracts from account", () => {
    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner, guardian] });
    });

    it("Should deploy a contract from the account", async () => {
      const artifact = artifacts.testDapp;
      const factory = new zksync.ContractFactory(artifact.abi, artifact.bytecode, account.signer);
      const transaction = factory.getDeployTransaction();
      account.signer.sendTransaction;
      console.log("transaction", transaction);
    });
  });

  describe("EIP-1271 signature verification of EIP-712 typed messages", () => {
    const domain = {
      name: "Ether Mail",
      version: "1",
      chainId: 1,
      verifyingContract: "0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC",
    };

    const types = {
      Person: [
        { name: "name", type: "string" },
        { name: "wallet", type: "address" },
      ],
      Mail: [
        { name: "from", type: "Person" },
        { name: "to", type: "Person" },
        { name: "contents", type: "string" },
      ],
    };

    const value = {
      from: { name: "Cow", wallet: "0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826" },
      to: { name: "Bob", wallet: "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB" },
      contents: "Hello, Bob!",
    };

    const hash = ethers.utils._TypedDataEncoder.hash(domain, types, value);
    const eip1271SuccessReturnValue = "0x1626ba7e";
    const signWith = (signatory: zksync.Wallet) => signatory._signTypedData(domain, types, value);

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
    });

    it("Should verify on the account", async () => {
      const signature = ethers.utils.concat([await signWith(owner), await signWith(guardian)]);
      expect(await account.isValidSignature(hash, signature)).to.equal(eip1271SuccessReturnValue);
    });

    it("Should verify with a single signature when not using a guardian", async () => {
      const accountNoGuardian = await deployAccount({ argent, ownerAddress, guardianAddress: AddressZero });
      const signature = await signWith(owner);
      expect(await accountNoGuardian.isValidSignature(hash, signature)).to.equal(eip1271SuccessReturnValue);
    });

    it("Should fail to verify using incorrect owners", async () => {
      let signature = ethers.utils.concat([await signWith(owner), await signWith(wrongGuardian)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = ethers.utils.concat([await signWith(owner), await signWith(owner)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = ethers.utils.concat([await signWith(guardian), await signWith(guardian)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;
    });

    it("Should fail to verify using zeros in any position", async () => {
      let signature = ethers.utils.concat([new Uint8Array(65), await signWith(guardian)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = ethers.utils.concat([await signWith(owner), new Uint8Array(65)]);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = new Uint8Array(130);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;
    });
  });
});
