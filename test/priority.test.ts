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
import { FixedEip712Signer } from "../src/fixedEip712Signer";

describe("Priority mode (from outside / L1)", () => {
  let argent: ArgentInfrastructure;
  let account: ArgentAccount;
  let signer: ArgentSigner;
  let testDapp: TestDapp;

  before(async () => {
    await checkDeployer(deployer);
    argent = await getTestInfrastructure(deployer);
  });


  interface BuildOutsideTransactionStructParams {
    transaction: TransactionRequest,
    signer: ArgentSigner,
    senderAddress: string,
  }

  const buildOutsideTransactionStruct = async (
    { transaction, signer, senderAddress }: BuildOutsideTransactionStructParams,
  ) => {
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
});
