import { TypedDataSigner } from "@ethersproject/abstract-signer";
import { Signer, TypedDataDomain, TypedDataField } from "ethers";
import { Bytes, BytesLike } from "ethers/lib/utils";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount } from "../typechain-types";
import { FixedEip712Signer } from "./fixedEip712Signer";
import { TransactionRequest } from "./model";

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
    if (transaction.from && transaction.from !== from) {
      throw new Error(`This signer can only sign transactions from ${from}, got ${transaction.from} instead.`);
    }
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
        gasPerPubdata: transaction.customData?.gasPerPubdata ?? zksync.utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
      },
    };
  }

  async signTransaction(transaction: TransactionRequest): Promise<string> {
    return zksync.utils.serialize({
      ...transaction,
      customData: {
        ...transaction.customData,
        customSignature: await this.getSignature(transaction),
      } as zksync.types.Eip712Meta,
    });
  }

  async getSignature(transaction: TransactionRequest): Promise<string> {
    const chainId = await this.getChainId();
    return this.concatSignatures((signer) => new FixedEip712Signer(signer, chainId).sign(transaction));
  }

  async getOutsideSignature(transaction: TransactionRequest, fromAddress: string): Promise<string> {
    const chainId = await this.getChainId();
    return this.concatSignatures(async (signer) => {
      const internalTransactionHash = await new FixedEip712Signer(signer, chainId).getTransactionHash(transaction);

      const selector = this.account.interface.getSighash("executeTransactionFromOutside");
      const message = ethers.utils.solidityPack(
        ["bytes4", "uint256", "address"],
        [selector, internalTransactionHash, fromAddress],
      );
      const messageHash = ethers.utils.arrayify(ethers.utils.keccak256(message));
      return await signer.signMessage(messageHash);
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
