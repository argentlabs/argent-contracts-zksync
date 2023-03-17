import { expect } from "chai";
import { deployAccount, makeCall } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { deployTestDapp, getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { ArgentAccount, TestDapp } from "../typechain-types";
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
      funds: "0.002",
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
});
