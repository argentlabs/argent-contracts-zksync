import * as zksync from "zksync-web3";
import { Signer } from "ethers";
import { TypedDataSigner } from "@ethersproject/abstract-signer";
import { _TypedDataEncoder } from "@ethersproject/hash";
import { TransactionRequest } from "./signer.service";

// replacement for zksync.EIP712Signer until they fix a bug with this PR https://github.com/matter-labs/zksync-era/pull/24
export class FixedEip712Signer {
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

  async getTransactionHash(transaction: TransactionRequest): Promise<string> {
    return _TypedDataEncoder.hash(
      await this.sdkSigner["eip712Domain"],
      FixedEip712Signer.eip712Types,
      FixedEip712Signer.getSignInput(transaction),
    );
  }

  async sign(transaction: TransactionRequest): Promise<zksync.types.Signature> {
    return await this.ethSigner._signTypedData(
      await this.sdkSigner["eip712Domain"],
      FixedEip712Signer.eip712Types,
      FixedEip712Signer.getSignInput(transaction),
    );
  }
}