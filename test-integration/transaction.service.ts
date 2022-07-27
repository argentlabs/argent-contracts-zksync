import { ethers } from "hardhat";
import * as zksync from "zksync-web3";

export const sendTransaction = async (
  transaction: zksync.types.TransactionRequest,
  from: string | zksync.Contract,
  provider: zksync.Provider,
  signatories: Array<zksync.Wallet | 0>,
  showSignature?: boolean,
) => {
  from = typeof from !== "string" ? from.address : from;

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

  const signaturePromises = signatories.map((signatory) =>
    signatory === 0
      ? Promise.resolve(new Uint8Array(65))
      : new zksync.EIP712Signer(signatory, chainId).sign(unsignedTransaction),
  );
  const signature = ethers.utils.concat(await Promise.all(signaturePromises));
  if (showSignature) {
    console.log("signature", signature)
  }

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
  return receipt;
};
