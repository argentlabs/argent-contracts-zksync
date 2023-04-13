import { TypedDataSigner } from "@ethersproject/abstract-signer";
import { Signer, TypedDataDomain, TypedDataField } from "ethers";
import { Bytes, BytesLike } from "ethers/lib/utils";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { ArgentAccount } from "../typechain-types";

export type TransactionRequest = zksync.types.TransactionRequest;
export type Signatory = (Signer & TypedDataSigner) | "zeros" | "random";

// replacement for zksync.EIP712Signer fixing a bug until they include the fix in their library
export class FixedEIP712Signer {
  static readonly eip712Types = {
    Transaction: [
      { name: "txType", type: "uint256" },
      { name: "from", type: "uint256" },
      { name: "to", type: "uint256" },
      { name: "gasLimit", type: "uint256" },
      { name: "gasPerPubdataByteLimit", type: "uint256" },
      { name: "maxFeePerGas", type: "uint256" },
      { name: "maxPriorityFeePerGas", type: "uint256" },
      { name: "paymaster", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "factoryDeps", type: "bytes32[]" },
      { name: "paymasterInput", type: "bytes" },
    ],
  };
  private readonly sdkSigner: zksync.EIP712Signer;
  constructor(private ethSigner: Signer & TypedDataSigner, chainId: number | Promise<number>) {
    this.sdkSigner = new zksync.EIP712Signer(ethSigner, chainId);
  }

  static getSignInput(transaction: TransactionRequest) {
    const buggySignInput = zksync.EIP712Signer.getSignInput(transaction);
    // ZkSync implementation treats zeros as if the value was not specified we fix it in the lines below
    const maxFeePerGas = transaction.maxFeePerGas ?? transaction.gasPrice ?? 0;
    const maxPriorityFeePerGas = transaction.maxPriorityFeePerGas ?? maxFeePerGas;
    const gasPerPubdataByteLimit = transaction.customData?.gasPerPubdata ?? zksync.utils.DEFAULT_GAS_PER_PUBDATA_LIMIT;
    return {
      ...buggySignInput,
      gasPerPubdataByteLimit,
      maxFeePerGas,
      maxPriorityFeePerGas: maxPriorityFeePerGas,
    };
  }

  async sign(transaction: TransactionRequest): Promise<zksync.types.Signature> {
    return await this.ethSigner._signTypedData(
      await this.sdkSigner["eip712Domain"],
      FixedEIP712Signer.eip712Types,
      FixedEIP712Signer.getSignInput(transaction),
    );
  }
}

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
    const txForEstimation = {
      ...transaction,
      type: zksync.utils.EIP712_TX_TYPE,
      from,
      data: transaction.data ?? "0x",
      value: transaction.value ?? "0x00",
      chainId: transaction.chainId ?? (await this.getChainId()),
      gasPrice: transaction.gasPrice ?? (await this.provider.getGasPrice()),
      nonce: transaction.nonce ?? (await this.provider.getTransactionCount(from, "pending")),
      customData: {
        ...transaction.customData,
        gasPerPubdata: transaction.customData?.gasPerPubdata ?? zksync.utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
      },
    };
    return {
      ...txForEstimation,
      gasLimit: transaction.gasLimit ?? (await this.provider.estimateGas(txForEstimation)),
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
    return this.concatSignatures((signer) => new FixedEIP712Signer(signer, chainId).sign(transaction));
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
