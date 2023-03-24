import { expect } from "chai";
import { BytesLike } from "ethers";
import * as zksync from "zksync-web3";
import { deployAccount } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { deployTestDapp, getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure } from "../src/model";
import { ArgentSigner, TransactionRequest } from "../src/signer.service";
import { ArgentAccount, TestDapp } from "../typechain-types";
import { TransactionStruct } from "../typechain-types/contracts/ArgentAccount";
import { deployer, guardian, guardianAddress, owner, ownerAddress } from "./fixtures";

describe("Priority mode (from outside / L1)", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;
  let signer: ArgentSigner;
  let testDapp: TestDapp;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
  });

  const toSolidityTransaction = (transaction: TransactionRequest, signature: BytesLike): TransactionStruct => {
    const signInput = zksync.EIP712Signer.getSignInput(transaction);
    return {
      ...signInput,
      reserved: [0, 0, 0, 0],
      signature,
      factoryDeps: [],
      paymasterInput: "0x",
      reservedDynamic: "0x",
    };
  };

  before(async () => {
    account = await deployAccount({
      argent,
      ownerAddress,
      guardianAddress,
      connect: [owner, guardian],
      funds: false, // priority transaction should work even if the account has no funds
    });
    signer = account.signer as ArgentSigner;
    testDapp = (await deployTestDapp(deployer)).connect(signer);
  });

  it("Should refuse to execute a priority transaction with invalid signature", async () => {
    const transaction = await testDapp.populateTransaction.setNumber(42n);
    const populated = await signer.populateTransaction(transaction);
    const signature = await new ArgentSigner(account, ["random", "random"]).getSignature(populated);
    const struct = toSolidityTransaction(populated, signature);
    const calldata = account.interface.encodeFunctionData("executeTransactionFromOutside", [struct]);

    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);

    // initiating L2 transfer via L1 execute from zksync wallet
    const promise = deployer.zkWallet.requestExecute({ contractAddress: account.address, calldata });
    await expect(promise).to.be.rejectedWith("argent/invalid-transaction");

    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);
  });

  it("Should execute a priority transaction", async () => {
    const transaction = await testDapp.populateTransaction.setNumber(42n);
    const populated = await signer.populateTransaction(transaction);
    const signature = await signer.getSignature(populated);
    const struct = toSolidityTransaction(populated, signature);
    const calldata = account.interface.encodeFunctionData("executeTransactionFromOutside", [struct]);

    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);

    // initiating L2 transfer via L1 execute from zksync wallet
    const response = await deployer.zkWallet.requestExecute({ contractAddress: account.address, calldata });
    await response.wait();

    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(42n);
  }).timeout(5 * 60e3);

  it("Should execute a priority transaction from L2", async () => {
    testDapp = (await deployTestDapp(deployer)).connect(signer);
    const transaction = await testDapp.populateTransaction.setNumber(42n);
    const populated = await signer.populateTransaction(transaction);
    const signature = await signer.getSignature(populated);
    const struct = toSolidityTransaction(populated, signature);

    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);

    const fromEoa = new zksync.Contract(account.address, account.interface, deployer.zkWallet) as ArgentAccount;
    const response = await fromEoa.executeTransactionFromOutside(struct);
    await response.wait();

    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(42n);
  });
});
