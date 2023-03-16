import { expect } from "chai";
import { Contract } from "ethers";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { deployAccount } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { getEscapeSignature } from "../src/recovery.service";
import { ArgentAccount } from "../typechain-types";
import { deployer, guardian, owner, provider } from "./fixtures";

describe("Paymaster tests", () => {
  let argent: ArgentInfrastructure;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
  });

  describe("No approve paymaster for tx signed only by one party", async () => {
    let account: ArgentAccount;
    let token: Contract;

    before(async () => {
      account = await deployAccount({
        argent,
        ownerAddress: owner.address,
        guardianAddress: guardian.address,
        funds: "0.05",
        connect: [guardian], // Important, the guardian ALONE is signing
      });
      const tokenArtifact = await deployer.loadArtifact("TestErc20");
      token = await deployer.deploy(tokenArtifact, ["TestToken", "TestToken", 0]);
    });

    it("Guardian alone cannot use the approval paymaster", async () => {
      const mintingResponse = await token.mint(account.address, 50000);
      await mintingResponse.wait();

      const paymaster = await deployer.deploy(await deployer.loadArtifact("BadPaymaster"));

      const tokenBalance = await token.balanceOf(account.address);

      const fundingResponse = await deployer.zkWallet.transfer({
        to: paymaster.address,
        amount: ethers.utils.parseEther("0.01"),
      });
      await fundingResponse.wait();

      const genericPaymasterParams = zksync.utils.getPaymasterParams(paymaster.address, {
        type: "General",
        innerInput: "0x",
      });

      const newOwner = zksync.Wallet.createRandom();
      const signature = await getEscapeSignature(newOwner, account, "triggerEscapeOwner");
      const overrides = { customData: { genericPaymasterParams } };
      const estimation = await account.estimateGas.triggerEscapeOwner(newOwner.address, signature, overrides);
      const gasLimit = estimation.mul(8); // Extra for the transfer to the paymaster

      const paymasterParams = zksync.utils.getPaymasterParams(paymaster.address, {
        type: "ApprovalBased",
        token: token.address,
        minimalAllowance: tokenBalance,
        innerInput: "0x",
      });

      const gasPrice = await provider.getGasPrice();

      const finalOverrides = {
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        gasLimit,
        customData: { paymasterParams },
      };
      const promise = account.triggerEscapeOwner(newOwner.address, signature, finalOverrides);

      await expect(promise).to.be.rejectedWith("argent/no-paymaster-with-single-signature");
    });
  });
});
