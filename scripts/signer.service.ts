import { Signer, TypedDataDomain, TypedDataField } from "ethers";
import { Bytes } from "ethers/lib/utils";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount } from "../typechain-types";

type TransactionRequest = zksync.types.TransactionRequest;
export type Signatories = Array<zksync.Wallet | 0>;

export class ArgentSigner extends Signer {
  public address: string;
  public provider: ArgentAccount["provider"];
  private _chainId?: number;

  constructor(readonly account: ArgentAccount, readonly signatories: Signatories) {
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
    throw new Error("signMessage not implemented");
  }

  async populateTransaction(transaction: TransactionRequest): Promise<TransactionRequest> {
    const from = this.address;
    return {
      ...transaction,
      type: zksync.utils.EIP712_TX_TYPE,
      from,
      data: transaction.data ?? "0x",
      value: transaction.value ?? "0x0",
      chainId: transaction.chainId ?? (await this.getChainId()),
      gasPrice: transaction.gasPrice ?? (await this.provider.getGasPrice()),
      gasLimit: transaction.gasLimit ?? (await this.provider.estimateGas({ ...transaction, from })),
      nonce: transaction.nonce ?? (await this.provider.getTransactionCount(from)),
    };
  }

  async signTransaction(transaction: TransactionRequest): Promise<string> {
    const chainId = await this.getChainId();

    const promises = this.signatories.map((signatory) =>
      signatory === 0
        ? Promise.resolve(new Uint8Array(65))
        : new zksync.EIP712Signer(signatory, chainId).sign(transaction),
    );
    const customSignature = ethers.utils.hexConcat(await Promise.all(promises));

    return zksync.utils.serialize({
      ...transaction,
      customData: {
        ...transaction.customData,
        customSignature,
      },
    });
  }

  async _signTypedData(
    domain: TypedDataDomain,
    types: Record<string, Array<TypedDataField>>,
    value: Record<string, any>,
  ): Promise<string> {
    const promises = this.signatories.map((signatory) =>
      signatory === 0 ? Promise.resolve(new Uint8Array(65)) : signatory._signTypedData(domain, types, value),
    );
    return ethers.utils.hexConcat(await Promise.all(promises));
  }

  connect(provider: zksync.Provider): ArgentSigner {
    return new ArgentSigner(this.account.connect(provider), this.signatories);
  }
}
