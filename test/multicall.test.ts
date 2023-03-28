import { expect } from "chai";
import { ethers } from "hardhat";
import { deployAccount, makeCall } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { deployTestDapp, getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { ArgentAccount, TestDapp, TestErc20 } from "../typechain-types";
import { deployer, guardian, guardianAddress, owner, ownerAddress } from "./fixtures";

describe("Account multicall", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;
  let testDapp: TestDapp;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
    account = await deployAccount({
      argent,
      ownerAddress,
      guardianAddress,
      connect: [owner, guardian],
      funds: "0.008",
    });
    testDapp = await deployTestDapp(deployer);
  });

  it("Should support the IMulticall interface", async () => {
    const interfaceId = account.interface.getSighash("multicall");
    await expect(account.supportsInterface(interfaceId)).to.eventually.be.true;
  });

  it("Should revert when one of the calls is to the account", async () => {
    const dappCall = makeCall(await testDapp.populateTransaction.setNumber(42));
    const recoveryCall = makeCall(await account.populateTransaction.cancelEscape());

    let promise = account.multicall([dappCall, recoveryCall]);
    await expect(promise).to.be.rejectedWith("argent/no-multicall-to-self");

    promise = account.multicall([recoveryCall, dappCall]);
    await expect(promise).to.be.rejectedWith("argent/no-multicall-to-self");
  });

  it("Should revert when one of the calls reverts", async () => {
    const dappCall = makeCall(await testDapp.populateTransaction.setNumber(42));
    const revertingCall = makeCall(await testDapp.populateTransaction.doRevert());

    let promise = account.multicall([dappCall, revertingCall]);
    await expect(promise).to.be.rejectedWith("foobarbaz");

    promise = account.multicall([revertingCall, dappCall]);
    await expect(promise).to.be.rejectedWith("foobarbaz");
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

  it("Should emit call return values in event", async () => {
    const response = await account.multicall([
      makeCall(await testDapp.populateTransaction.setNumber(32)),
      makeCall(await testDapp.populateTransaction.increaseNumber(10)),
      makeCall(await testDapp.populateTransaction.increaseNumber(27)),
    ]);
    const coder = ethers.utils.defaultAbiCoder;
    const returnValues = ["0x", coder.encode(["uint256"], [42]), coder.encode(["uint256"], [69])];
    const returnData = coder.encode(["bytes[]"], [returnValues]);
    await expect(response).to.emit(account, "TransactionExecuted").withArgs(response.hash, returnData);
  });

  describe("Approve + deposit multicalls", async () => {
    let token: TestErc20;

    before(async () => {
      const tokenArtifact = await deployer.loadArtifact("TestErc20");
      token = (await deployer.deploy(tokenArtifact, ["TestToken", "TestToken", 0])) as TestErc20;
      const response = await token.mint(account.address, 100);
      await response.wait();
    });

    it("Should revert with insufficient allowance", async () => {
      await expect(token.balanceOf(account.address)).to.eventually.equal(100);

      const promise = account.multicall([
        makeCall(await token.populateTransaction.approve(testDapp.address, 69)),
        makeCall(await testDapp.populateTransaction.depositTokens(token.address, 100)),
      ]);
      await expect(promise).to.be.rejectedWith("ERC20: insufficient allowance");

      await expect(token.balanceOf(account.address)).to.eventually.equal(100);
    });

    it("Should succeed", async () => {
      await expect(token.balanceOf(account.address)).to.eventually.equal(100);

      const response = await account.multicall([
        makeCall(await token.populateTransaction.approve(testDapp.address, 69)),
        makeCall(await testDapp.populateTransaction.depositTokens(token.address, 69)),
      ]);
      await response.wait();

      await expect(token.balanceOf(account.address)).to.eventually.equal(31);
    });
  });
});
