import { TypedDataSigner } from "@ethersproject/abstract-signer";
import { Signer, TypedDataDomain, TypedDataField } from "ethers";
import { Bytes, BytesLike } from "ethers/lib/utils";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount } from "../typechain-types";

type TransactionRequest = zksync.types.TransactionRequest;
export type Signatory = (Signer & TypedDataSigner) | "zeros" | "random";

export class ArgentSigner extends Signer {
  public address: string;
  public provider: ArgentAccount["provider"];
  private _chainId?: number;

  constructor(readonly account: ArgentAccount, readonly signatories: Signatory[]) {
    super();
    this.address = account.address;
    this.provider = account.provider;
  }

  async getAddress(): Promise<string> {
    return this.address;
  }
  async getChainId(): Promise<number> {
    if (this._chainId === undefined) {
      const { chainId } = await this.provider.getNetwork();
      this._chainId = chainId;
    }
    return this._chainId;
  }

  async signMessage(message: Bytes | string): Promise<string> {
    if (ethers.utils.isHexString(message)) {
      message = ethers.utils.arrayify(message);
    }
    return this.concatSignatures((signer) => signer.signMessage(message));
  }

  async _signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>,
  ): Promise<string> {
    return this.concatSignatures((signer) => signer._signTypedData(domain, types, value));
  }

  async populateTransaction(transaction: TransactionRequest): Promise<TransactionRequest> {
    const from = this.address;
    return {
      ...transaction,
      type: zksync.utils.EIP712_TX_TYPE,
      from,
      data: transaction.data ?? "0x",
      value: transaction.value ?? "0x00",
      chainId: transaction.chainId ?? (await this.getChainId()),
      gasPrice: transaction.gasPrice ?? (await this.provider.getGasPrice()),
      gasLimit: transaction.gasLimit ?? (await this.provider.estimateGas({ ...transaction, from })),
      nonce: transaction.nonce ?? (await this.provider.getTransactionCount(from, "pending")),
      customData: {
        ...transaction.customData,
        ergsPerPubdata: transaction.customData?.gasPerPubdata ?? zksync.utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
      },
    };
  }

  async signTransaction(transaction: TransactionRequest): Promise<string> {
    const chainId = await this.getChainId();
    const customSignature = await this.concatSignatures((signer) =>
      new zksync.EIP712Signer(signer, chainId).sign(transaction),
    );

    return zksync.utils.serialize({
      ...transaction,
      customData: {
        ...transaction.customData,
        customSignature,
      },
    });
  }

  private async concatSignatures(sign: (signer: Signer & TypedDataSigner) => Promise<BytesLike>): Promise<string> {
    const promises = this.signatories.map(async (signatory) => {
      if (signatory === "zeros") {
        return new Uint8Array(65);
      }
      if (signatory === "random") {
        return sign(zksync.Wallet.createRandom());
      }
      return sign(signatory);
    });
    return ethers.utils.hexConcat(await Promise.all(promises));
  }

  connect(provider: zksync.Provider): ArgentSigner {
    return new ArgentSigner(this.account.connect(provider), this.signatories);
  }
}
