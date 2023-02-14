import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { deployAccount } from "../scripts/account.service";
import { checkDeployer, getDeployer } from "../scripts/deployer.service";
import { getTestInfrastructure } from "../scripts/infrastructure.service";
import { ArgentInfrastructure } from "../scripts/model";
import { ArgentSigner, Signatory } from "../scripts/signer.service";
import { ArgentAccount } from "../typechain-types";

const { AddressZero } = ethers.constants;

const owner = zksync.Wallet.createRandom();
const guardian = zksync.Wallet.createRandom();
const wrongGuardian = zksync.Wallet.createRandom();

const ownerAddress = owner.address;
const guardianAddress = guardian.address;
const { deployer } = getDeployer();

const eip1271MagicValue = zksync.utils.EIP1271_MAGIC_VALUE;

describe("Argent signer", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
  });

  describe("EIP-1271 signature verification of Ethereum signed messages", () => {
    const message = ethers.utils.randomBytes(100);
    const hash = ethers.utils.hashMessage(message);

    const signAndCheck = async (signatories: Signatory[]) => {
      const signer = new ArgentSigner(account, signatories);
      const signature = await signer.signMessage(message);
      return account.isValidSignature(hash, signature);
    };

    describe("Without guardian", () => {
      before(async () => {
        account = await deployAccount({ argent, ownerAddress, guardianAddress: AddressZero, funds: false });
      });

      it("Should verify on the account", async () => {
        await expect(signAndCheck([owner])).to.eventually.equal(eip1271MagicValue);
      });

      it("Should fail to verify invalid signatures", async () => {
        await expect(signAndCheck(["random"])).to.eventually.equal(0n);
        await expect(signAndCheck(["zeros"])).to.eventually.equal(0n);
      });

      it("Should fail to verify with wrong signature length", async () => {
        await expect(signAndCheck([owner, "zeros"])).to.eventually.equal(0n);
        await expect(signAndCheck([owner, "random"])).to.eventually.equal(0n);
        await expect(signAndCheck([owner, owner, owner])).to.be.reverted;
        await expect(signAndCheck([owner, owner, owner])).to.be.reverted;
        await expect(signAndCheck(["zeros", "zeros", "zeros"])).to.be.reverted;
        await expect(signAndCheck(["random", "random", "random"])).to.be.reverted;
        await expect(account.isValidSignature(hash, new Uint8Array())).to.be.reverted;
        await expect(account.isValidSignature(hash, new Uint8Array(1))).to.be.reverted;
        await expect(account.isValidSignature(hash, new Uint8Array(64))).to.be.reverted;
        await expect(account.isValidSignature(hash, new Uint8Array(66))).to.be.reverted;
      });
    });

    describe("With guardian", () => {
      before(async () => {
        account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
      });

      it("Should verify on the account", async () => {
        await expect(signAndCheck([owner, guardian])).to.eventually.equal(eip1271MagicValue);
      });

      it("Should fail to verify with wrong signature length", async () => {
        await expect(signAndCheck([owner])).to.eventually.equal(0n);
        await expect(signAndCheck([guardian])).to.eventually.equal(0n);
        await expect(signAndCheck(["random"])).to.eventually.equal(0n);
        await expect(signAndCheck(["zeros"])).to.eventually.equal(0n);
      });

      it("Should fail to verify with invalid signatures", async () => {
        await expect(signAndCheck([owner, owner])).to.eventually.equal(0n);
        await expect(signAndCheck([guardian, guardian])).to.eventually.equal(0n);
        await expect(signAndCheck(["random", "random"])).to.eventually.equal(0n);
        await expect(signAndCheck(["zeros", "zeros"])).to.eventually.equal(0n);
      });
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

    const signAndCheck = async (signatories: Signatory[]) => {
      const signer = new ArgentSigner(account, signatories);
      const signature = await signer._signTypedData(domain, types, value);
      return account.isValidSignature(hash, signature);
    };

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
    });

    it("Should verify on the account", async () => {
      await expect(signAndCheck([owner, guardian])).to.eventually.equal(eip1271MagicValue);
    });

    it("Should verify with a single signature when not using a guardian", async () => {
      const accountNoGuardian = await deployAccount({ argent, ownerAddress, guardianAddress: AddressZero });
      const signature = await new ArgentSigner(accountNoGuardian, [owner])._signTypedData(domain, types, value);
      await expect(accountNoGuardian.isValidSignature(hash, signature)).to.eventually.equal(eip1271MagicValue);
    });

    it("Should fail to verify using incorrect owners", async () => {
      await expect(signAndCheck([owner, wrongGuardian])).to.eventually.equal(0n);
      await expect(signAndCheck([owner, owner])).to.eventually.equal(0n);
      await expect(signAndCheck([guardian, guardian])).to.eventually.equal(0n);
      await expect(signAndCheck(["random", "random"])).to.eventually.equal(0n);
    });

    it("Should fail to verify using zeros in any position", async () => {
      await expect(signAndCheck(["zeros", guardian])).to.eventually.equal(0n);
      await expect(signAndCheck([owner, "zeros"])).to.eventually.equal(0n);
      await expect(account.isValidSignature(hash, new Uint8Array(65))).to.eventually.equal(0n);
      await expect(account.isValidSignature(hash, new Uint8Array(130))).to.eventually.equal(0n);
    });

    it("Should fail to verify with invalid length", async () => {
      await expect(account.isValidSignature(hash, new Uint8Array())).to.be.reverted;
      await expect(account.isValidSignature(hash, new Uint8Array(1))).to.be.reverted;
      await expect(account.isValidSignature(hash, new Uint8Array(136))).to.be.reverted;
      await expect(account.isValidSignature(hash, new Uint8Array(195))).to.be.reverted;
    });
  });
});
