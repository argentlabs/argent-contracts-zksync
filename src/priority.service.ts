import { BytesLike } from "ethers";
import { TransactionStruct } from "../typechain-types/contracts/ArgentAccount";
import { FixedEip712Signer } from "./fixedEip712Signer";
import { TransactionRequest } from "./model";
import { ArgentSigner } from "./signer.service";

interface BuildOutsideTransactionStructParams {
  transaction: TransactionRequest;
  signer: ArgentSigner;
  senderAddress: string;
}

export const buildOutsideTransactionStruct = async ({
  transaction,
  signer,
  senderAddress,
}: BuildOutsideTransactionStructParams) => {
  const transactionFromOutside = toOutsideTransaction(transaction);
  const populated = await signer.populateTransaction(transactionFromOutside);
  const signature = await signer.getOutsideSignature(populated, senderAddress);
  return toSolidityTransaction(populated, signature);
};

const toOutsideTransaction = (transaction: TransactionRequest): TransactionRequest => ({
  ...transaction,
  gasPrice: 0,
  gasLimit: 0,
  customData: {
    ...transaction.customData,
    gasPerPubdata: 0,
  },
});

const toSolidityTransaction = (transaction: TransactionRequest, signature: BytesLike): TransactionStruct => {
  const signInput = FixedEip712Signer.getSignInput(transaction);
  return {
    ...signInput,
    reserved: [0, 0, 0, 0],
    reservedDynamic: "0x",
    signature,
  };
};
