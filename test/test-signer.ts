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

describe("Argent account", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
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

    before(async () => {
      account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: false });
    });

    it("Should verify on the account", async () => {
      const signature = await new ArgentSigner(account, [owner, guardian])._signTypedData(domain, types, value);
      expect(await account.isValidSignature(hash, signature)).to.equal(eip1271SuccessReturnValue);
    });

    it("Should verify with a single signature when not using a guardian", async () => {
      const accountNoGuardian = await deployAccount({ argent, ownerAddress, guardianAddress: AddressZero });
      const signature = await new ArgentSigner(accountNoGuardian, [owner])._signTypedData(domain, types, value);
      expect(await accountNoGuardian.isValidSignature(hash, signature)).to.equal(eip1271SuccessReturnValue);
    });

    it("Should fail to verify using incorrect owners", async () => {
      let signature = await new ArgentSigner(account, [owner, wrongGuardian])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = await new ArgentSigner(account, [owner, owner])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = await new ArgentSigner(account, [guardian, guardian])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;
    });

    it("Should fail to verify using zeros in any position", async () => {
      let signature = await new ArgentSigner(account, [0, guardian])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      signature = await new ArgentSigner(account, [owner, 0])._signTypedData(domain, types, value);
      await expect(account.isValidSignature(hash, signature)).to.be.rejected;

      await expect(account.isValidSignature(hash, new Uint8Array(130))).to.be.rejected;
    });
  });
});
