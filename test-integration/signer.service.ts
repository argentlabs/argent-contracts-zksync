import { ethers } from "hardhat";
import { Signer } from "ethers";
import { Bytes } from "ethers/lib/utils";
import * as zksync from "zksync-web3";
import { Provider } from "@ethersproject/providers";

type TransactionRequest = zksync.types.TransactionRequest;
export type Signatories = Array<zksync.Wallet | 0>;

const concatSignatures = async (transaction: TransactionRequest, signatories: Signatories, chainId: number) => {
  const signaturePromises = signatories.map((signatory) =>
    signatory === 0
      ? Promise.resolve(new Uint8Array(65))
      : new zksync.EIP712Signer(signatory, chainId).sign(transaction),
  );
  return ethers.utils.concat(await Promise.all(signaturePromises));
};

// TODO: make a BackendArgentSigner that fetches the guardian signature from the backend.
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
    const { chainId } = await this.provider.getNetwork();
    const gasLimit = await this.provider.estimateGas({ ...transaction, from });
    const unsignedTransaction = {
      type: zksync.utils.EIP712_TX_TYPE,
      to: transaction.to,
      data: transaction.data ?? "0x",
      value: transaction.value ?? "0x0",
      chainId: transaction.chainId ?? chainId,
      gasPrice: transaction.gasPrice ?? (await this.provider.getGasPrice()),
      gasLimit: transaction.gasLimit ?? gasLimit,
      nonce: transaction.nonce ?? (await this.provider.getTransactionCount(from)),
      customData: {
        ergsPerPubdata: transaction.customData?.ergsPerPubData ?? 0,
        feeToken: transaction.customData?.feeToken ?? zksync.utils.ETH_ADDRESS,
      },
    };

    const signature = await concatSignatures(unsignedTransaction, this.signatories, chainId);

    const transactionRequest = {
      ...unsignedTransaction,
      customData: {
        ...unsignedTransaction.customData,
        aaParams: { from, signature },
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
