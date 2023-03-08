import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { deployAccount } from "../src/account.service";
import { checkDeployer, getDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { ArgentAccount } from "../typechain-types";
import { Contract } from "ethers";
import { expect } from "chai";

const owner = zksync.Wallet.createRandom();
const guardian = zksync.Wallet.createRandom();
const { deployer, provider } = getDeployer();


describe("Poc", () => {
  let argent: ArgentInfrastructure;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
  });


  describe("No approve paymaster for tx signed only by one party", async () => {
    let account: ArgentAccount;
    let token: Contract
    before(async () => {
      account = await deployAccount({
        argent,
        ownerAddress: owner.address,
        guardianAddress: guardian.address,
        funds: "1",
        connect: [guardian], // Important, the guardian ALONE can sign this
      });
      const tokenArtifact = await deployer.loadArtifact("TestErc20");
      token = await deployer.deploy(tokenArtifact, ["TestToken", "TestToken", 0]);
    });


    it("Guardian alone cannot use the approval paymaster", async () => {

      await (await token.mint(account.address, 50000)).wait;

      const paymaster = await deployer.deploy(await deployer.loadArtifact("BadPaymaster"));

      const tokenBalance = await token.balanceOf(account.address);

      const responseFundPaymaster = await deployer.zkWallet.transfer({
        to: paymaster.address,
        amount: ethers.utils.parseEther("0.01"),
      });
      await responseFundPaymaster.wait();

      const genericPaymasterParams = zksync.utils.getPaymasterParams(paymaster.address, {
        type: "General",
        innerInput: "0x",
      });

      const gasLimit = (await account.estimateGas.triggerEscapeOwner({ customData: { genericPaymasterParams } }))
        .mul(8); // Extra for the transfer to the paymaster

      const paymasterParams = zksync.utils.getPaymasterParams(paymaster.address, {
        type: "ApprovalBased",
        token: token.address,
        minimalAllowance: tokenBalance,
        innerInput: "0x",
      });

      const gasPrice = await provider.getGasPrice();
      console.log(`Account token before     ${await token.balanceOf(account.address)}`);
      console.log(`Paymaster token before   ${await token.balanceOf(paymaster.address)}`);
      console.log(`Account balance before   ${await provider.getBalance(account.address)}`);
      console.log(`Paymaster balance before ${await provider.getBalance(paymaster.address)}`);

      const txSubmission = account.triggerEscapeOwner({
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: gasPrice,
        gasLimit,
        customData: { paymasterParams },
      });

      await expect(txSubmission).to.be.rejectedWith("argent/no-paymaster-with-single-signature");

      console.log(`Account after        ${await provider.getBalance(account.address)}`);
      console.log(`Paymaster after       ${await provider.getBalance(paymaster.address)}`);
      console.log(`Account token after   ${await token.balanceOf(account.address)}`);
      console.log(`Paymaster token after ${await token.balanceOf(paymaster.address)}`);

    });
  });

});
