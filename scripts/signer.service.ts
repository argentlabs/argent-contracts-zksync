import { Provider } from "@ethersproject/providers";
import { Signer } from "ethers";
import { Bytes } from "ethers/lib/utils";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";

type TransactionRequest = zksync.types.TransactionRequest;
export type Signatories = Array<zksync.Wallet | 0>;

const concatSignatures = async (transaction: TransactionRequest, signatories: Signatories, chainId: number) => {
  const signaturePromises = signatories.map((signatory) =>
    signatory === 0
      ? Promise.resolve(new Uint8Array(65))
      : new zksync.EIP712Signer(signatory, chainId).sign(transaction),
  );
  return ethers.utils.hexlify(ethers.utils.concat(await Promise.all(signaturePromises)));
};

export class MultiSigner extends Signer {
  constructor(readonly address: string, readonly signatories: Signatories, readonly provider: Provider) {
    super();
  }

  getAddress(): Promise<string> {
    return Promise.resolve(this.address);
  }

  signMessage(message: Bytes | string): Promise<string> {
    throw new Error("signMessage not implemented");
  }

  async signTransaction(transaction: TransactionRequest): Promise<string> {
    const from = this.address;
    const chainId = transaction.chainId ?? (await this.provider.getNetwork()).chainId;
    const gasLimit = await this.provider.estimateGas({ ...transaction, from });
    const unsignedTransaction = {
      type: zksync.utils.EIP712_TX_TYPE,
      to: transaction.to,
      from,
      data: transaction.data ?? "0x",
      value: transaction.value ?? "0x0",
      chainId,
      gasPrice: transaction.gasPrice ?? (await this.provider.getGasPrice()),
      gasLimit: transaction.gasLimit ?? gasLimit,
      nonce: transaction.nonce ?? (await this.provider.getTransactionCount(from)),
      customData: transaction.customData,
    };

    const customSignature = await concatSignatures(unsignedTransaction, this.signatories, chainId);

    const transactionRequest = {
      ...unsignedTransaction,
      customData: {
        ...unsignedTransaction.customData,
        customSignature,
      },
    };

    const serialized = zksync.utils.serialize(transactionRequest);
    return serialized;
  }

  /*
  _signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>,
  ): Promise<string> {
    throw new Error("signMessage not implemented");
  }
  */

  connect(provider: zksync.Provider): MultiSigner {
    return new MultiSigner(this.address, this.signatories, provider);
  }
}
