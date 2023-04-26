import { expect } from "chai";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { connect, deployAccount, makeCall } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { ArgentAccount, UpgradedArgentAccount } from "../typechain-types";
import { deployer, guardian, guardianAddress, owner, ownerAddress, wrongGuardian, wrongOwner } from "./fixtures";

describe("Account upgrade", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;
  let newImplementation: zksync.Contract;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
    account = await deployAccount({ argent, ownerAddress, guardianAddress, funds: "0.008" });
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
    await expect(promise).to.be.rejectedWith("argent/invalid-implementation");
  });

  it("Should revert when calling upgrade callback directly", async () => {
    const promise = connect(account, [owner, guardian]).executeAfterUpgrade(argent.implementation.address, "0x");
    await expect(promise).to.be.rejectedWith("argent/forbidden-call");
  });

  it("Should revert when calling upgrade callback via multicall", async () => {
    const call = makeCall(await account.populateTransaction.executeAfterUpgrade(argent.implementation.address, "0x"));
    const promise = connect(account, [owner, guardian]).multicall([call]);
    await expect(promise).to.be.rejectedWith("argent/no-multicall-to-self");
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
      funds: "0.008",
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
    await expect(promise).to.be.rejectedWith("argent/upgrade-callback-failed");

    const value = 42;
    const data = new ethers.utils.AbiCoder().encode(["uint256"], [value]);

    const response = await account.upgrade(newImplementation.address, data);
    await response.wait();

    await expect(upgradedAccount.newStorage()).to.eventually.equal(value);
  });
});
