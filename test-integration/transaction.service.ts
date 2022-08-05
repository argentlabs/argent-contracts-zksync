import { ethers } from "hardhat";
import * as zksync from "zksync-web3";

type Signatories = Array<zksync.Wallet | 0>;
type TransactionRequest = zksync.types.TransactionRequest;

export const sendTransaction = async (
  transaction: TransactionRequest,
  signatories: Signatories,
  from: string | zksync.Contract,
  provider: zksync.Provider,
) => {
  from = typeof from === "string" ? from : from.address;

  const { chainId } = await provider.getNetwork();
  const unsignedTransaction = {
    type: zksync.utils.EIP712_TX_TYPE,
    to: transaction.to,
    data: transaction.data ?? "0x",
    value: transaction.value ?? "0x0",
    chainId: transaction.chainId ?? chainId,
    gasPrice: transaction.gasPrice ?? (await provider.getGasPrice()),
    gasLimit: transaction.gasLimit ?? (await provider.estimateGas(transaction)),
    nonce: transaction.nonce ?? (await provider.getTransactionCount(from)),
    customData: {
      ergsPerPubdata: transaction.customData?.ergsPerPubData ?? 0,
      feeToken: transaction.customData?.feeToken ?? zksync.utils.ETH_ADDRESS,
    },
  };

  const signature = await signTransaction(unsignedTransaction, signatories, chainId);

  const transactionRequest = {
    ...unsignedTransaction,
    customData: {
      ...unsignedTransaction.customData,
      aaParams: { from, signature },
    },
  };

  const serialized = zksync.utils.serialize(transactionRequest);
  return provider.sendTransaction(serialized);
};

export const waitForTransaction = async (...args: Parameters<typeof sendTransaction>) => {
  const response = await sendTransaction(...args);
  const receipt = await response.wait();
  return { response, receipt };
};

export const makeTransactionSender = (from: string | zksync.Contract, provider: zksync.Provider) => ({
  sendTransaction: (transaction: TransactionRequest, signatories: Signatories) =>
    sendTransaction(transaction, signatories, from, provider),
  waitForTransaction: (transaction: TransactionRequest, signatories: Signatories) =>
    waitForTransaction(transaction, signatories, from, provider),
});

export type TransactionSender = ReturnType<typeof makeTransactionSender>;

export const signTransaction = async (transaction: TransactionRequest, signatories: Signatories, chainId: number) => {
  const signaturePromises = signatories.map((signatory) =>
    signatory === 0
      ? Promise.resolve(new Uint8Array(65))
      : new zksync.EIP712Signer(signatory, chainId).sign(transaction),
  );
  const signature = ethers.utils.concat(await Promise.all(signaturePromises));
  return ethers.utils.hexlify(signature);
};
