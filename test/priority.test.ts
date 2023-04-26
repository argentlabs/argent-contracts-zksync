import { expect } from "chai";
import { BytesLike } from "ethers";
import * as zksync from "zksync-web3";
import { deployAccount } from "../src/account.service";
import { checkDeployer } from "../src/deployer.service";
import { FixedEip712Signer } from "../src/fixedEip712Signer";
import { deployTestDapp, getTestInfrastructure } from "../src/infrastructure.service";
import { ArgentInfrastructure, TransactionRequest } from "../src/model";
import { ArgentSigner } from "../src/signer.service";
import { ArgentAccount, ReentrancyExploiter, TestDapp } from "../typechain-types";
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

  interface BuildOutsideTransactionStructParams {
    transaction: TransactionRequest;
    signer: ArgentSigner;
    senderAddress: string;
  }

  const buildOutsideTransactionStruct = async ({
    transaction,
    signer,
    senderAddress,
  }: BuildOutsideTransactionStructParams) => {
    const transactionFromOutside = toOutsideTransaction(transaction);
    const populated = await signer.populateTransaction(transactionFromOutside);
    const signature = await signer.getOutsideSignature(populated, senderAddress);
    return toSolidityTransaction(populated, signature);
  };

  const toOutsideTransaction = (transaction: TransactionRequest): TransactionRequest => {
    return {
      ...transaction,
      gasPrice: 0,
      gasLimit: 0,
      customData: {
        ...transaction.customData,
        gasPerPubdata: 0,
      },
    };
  };

  const toSolidityTransaction = (transaction: TransactionRequest, signature: BytesLike): TransactionStruct => {
    const signInput = FixedEip712Signer.getSignInput(transaction);
    return {
      ...signInput,
      reserved: [0, 0, 0, 0],
      reservedDynamic: "0x",
      signature,
    };
  };

  it("Should refuse to execute a priority transaction with invalid signature", async () => {
    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);

    const struct = await buildOutsideTransactionStruct({
      transaction: await testDapp.populateTransaction.setNumber(42n),
      signer: new ArgentSigner(account, ["random", "random"]),
      senderAddress: deployer.zkWallet.address,
    });
    const calldata = account.interface.encodeFunctionData("executeTransactionFromOutside", [struct]);

    // initiating L2 transfer via L1 execute from zksync wallet
    const promise = deployer.zkWallet.requestExecute({ contractAddress: account.address, calldata });
    await expect(promise).to.be.rejectedWith("argent/invalid-transaction");

    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);
  });

  it("Should execute a priority transaction from L1", async () => {
    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);

    const struct = await buildOutsideTransactionStruct({
      transaction: await testDapp.populateTransaction.setNumber(42n),
      signer,
      senderAddress: deployer.zkWallet.address,
    });
    const calldata = account.interface.encodeFunctionData("executeTransactionFromOutside", [struct]);

    // initiating L2 transfer via L1 execute from zksync wallet
    const response = await deployer.zkWallet.requestExecute({
      contractAddress: account.address,
      calldata,
      l2GasLimit: 1_000_000,
    });

    await response.wait();

    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(42n);
  }).timeout(5 * 60e3);

  it("Should execute a priority transaction from L2", async () => {
    testDapp = (await deployTestDapp(deployer)).connect(signer);
    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);

    const struct = await buildOutsideTransactionStruct({
      transaction: await testDapp.populateTransaction.setNumber(42n),
      signer,
      senderAddress: deployer.zkWallet.address,
    });

    const fromEoa = new zksync.Contract(account.address, account.interface, deployer.zkWallet) as ArgentAccount;
    const response = await fromEoa.executeTransactionFromOutside(struct);
    await response.wait();

    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(42n);
  });

  it("Should refuse reentrant priority transactions", async () => {
    const account = await deployAccount({ argent, ownerAddress, guardianAddress, connect: [owner, guardian] });
    const signer = account.signer as ArgentSigner;

    const artifact = await deployer.loadArtifact("ReentrancyExploiter");
    const exploiter = (await deployer.deploy(artifact)).connect(signer) as ReentrancyExploiter;

    testDapp = (await deployTestDapp(deployer)).connect(signer);
    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);

    const nonce = await signer.getTransactionCount();
    const transaction = await testDapp.populateTransaction.setNumber(42n, { nonce: nonce + 1 });
    const struct = await buildOutsideTransactionStruct({ transaction, signer, senderAddress: exploiter.address });

    const promise = exploiter.reenterFromOutside(struct);
    await expect(promise).to.be.rejectedWith("argent/reentrant-call");

    await expect(testDapp.userNumbers(account.address)).to.eventually.equal(0n);
  });
});
