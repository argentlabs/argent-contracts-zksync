import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import { expect } from "chai";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { deployAccount } from "../scripts/account.service";
import { checkDeployer, getDeployer } from "../scripts/deployer.service";
import { getTestInfrastructure } from "../scripts/infrastructure.service";
import { ArgentInfrastructure } from "../scripts/model";
import { ArgentSigner } from "../scripts/signer.service";
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
  let signature;
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
  });

  describe("EIP-1271 signature verification of Ethereum signed messages", () => {
    const message = ethers.utils.randomBytes(100);
    const hash = ethers.utils.hashMessage(message);

    describe("Without guardian", () => {
      before(async () => {
        account = await deployAccount({ argent, ownerAddress, guardianAddress: AddressZero, funds: false });
      });

      it("Should verify on the account", async () => {
        signature = await new ArgentSigner(account, [owner]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(eip1271MagicValue);
      });

      it("Should fail to verify with wrong signature length", async () => {
        signature = await new ArgentSigner(account, [owner, "zeros"]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

        signature = await new ArgentSigner(account, [owner, "random"]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

        signature = await new ArgentSigner(account, [owner, owner, owner]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.be.reverted;

        signature = await new ArgentSigner(account, ["zeros", "zeros", "zeros"]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.be.reverted;

        signature = await new ArgentSigner(account, ["random", "random", "random"]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.be.reverted;

        await expect(account.isValidSignature(hash, new Uint8Array())).to.be.reverted;
        await expect(account.isValidSignature(hash, new Uint8Array(1))).to.be.reverted;
        await expect(account.isValidSignature(hash, new Uint8Array(64))).to.be.reverted;
        await expect(account.isValidSignature(hash, new Uint8Array(66))).to.be.reverted;
      });

      it("Should fail to verify with invalid signatures", async () => {
        signature = await new ArgentSigner(account, ["random"]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

        signature = await new ArgentSigner(account, ["zeros"]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);
      });
    });

    describe("With guardian", () => {
      before(async () => {
        account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
      });

      it("Should verify on the account", async () => {
        signature = await new ArgentSigner(account, [owner, guardian]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(eip1271MagicValue);
      });

      it("Should fail to verify with wrong signature length", async () => {
        signature = await new ArgentSigner(account, [owner]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

        signature = await new ArgentSigner(account, ["random"]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

        signature = await new ArgentSigner(account, ["zeros"]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);
      });

      it("Should fail to verify with invalid signatures", async () => {
        signature = await new ArgentSigner(account, [owner, owner]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

        signature = await new ArgentSigner(account, [guardian, guardian]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

        signature = await new ArgentSigner(account, ["random", "random"]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

        signature = await new ArgentSigner(account, ["zeros", "zeros"]).signMessage(message);
        await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);
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

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
    });

    it("Should verify on the account", async () => {
      const signature = await new ArgentSigner(account, [owner, guardian])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.eventually.equal(eip1271MagicValue);
    });

    it("Should verify with a single signature when not using a guardian", async () => {
      const accountNoGuardian = await deployAccount({ argent, ownerAddress, guardianAddress: AddressZero });
      const signature = await new ArgentSigner(accountNoGuardian, [owner])._signTypedData(domain, types, value);
      await expect(accountNoGuardian.isValidSignature(hash, signature)).to.eventually.equal(eip1271MagicValue);
    });

    it("Should fail to verify using incorrect owners", async () => {
      signature = await new ArgentSigner(account, [owner, wrongGuardian])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

      signature = await new ArgentSigner(account, [owner, owner])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

      signature = await new ArgentSigner(account, [guardian, guardian])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

      signature = await new ArgentSigner(account, ["random", "random"])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);
    });

    it("Should fail to verify using zeros in any position", async () => {
      signature = await new ArgentSigner(account, ["zeros", guardian])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

      signature = await new ArgentSigner(account, [owner, "zeros"])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.eventually.equal(0n);

      await expect(account.isValidSignature(hash, new Uint8Array(130))).to.eventually.equal(0n);
    });
  });
});
