/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import type { Provider } from "@ethersproject/providers";
import { Contract, Signer, utils } from "ethers";
import type {
  IContractDeployer,
  IContractDeployerInterface,
} from "../../../../../../@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IContractDeployer";

const _abi = [
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "address",
        name: "deployerAddress",
        type: "address",
      },
      {
        indexed: true,
        internalType: "bytes32",
        name: "bytecodeHash",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "contractAddress",
        type: "address",
      },
    ],
    name: "ContractDeployed",
    type: "event",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes",
      },
    ],
    name: "create",
    outputs: [
      {
        internalType: "address",
        name: "newAddress",
        type: "address",
      },
      {
        internalType: "bytes",
        name: "constructorRevertData",
        type: "bytes",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes",
      },
    ],
    name: "create2",
    outputs: [
      {
        internalType: "address",
        name: "newAddress",
        type: "address",
      },
      {
        internalType: "bytes",
        name: "constructorRevertData",
        type: "bytes",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes",
      },
    ],
    name: "create2Account",
    outputs: [
      {
        internalType: "address",
        name: "newAddress",
        type: "address",
      },
      {
        internalType: "bytes",
        name: "constructorRevertData",
        type: "bytes",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes",
      },
    ],
    name: "createAccount",
    outputs: [
      {
        internalType: "address",
        name: "newAddress",
        type: "address",
      },
      {
        internalType: "bytes",
        name: "constructorRevertData",
        type: "bytes",
      },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_sender",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_senderNonce",
        type: "uint256",
      },
    ],
    name: "getNewAddressCreate",
    outputs: [
      {
        internalType: "address",
        name: "newAddress",
        type: "address",
      },
    ],
    stateMutability: "pure",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "_sender",
        type: "address",
      },
      {
        internalType: "bytes32",
        name: "_bytecodeHash",
        type: "bytes32",
      },
      {
        internalType: "bytes32",
        name: "_salt",
        type: "bytes32",
      },
      {
        internalType: "bytes",
        name: "_input",
        type: "bytes",
      },
    ],
    name: "getNewAddressCreate2",
    outputs: [
      {
        internalType: "address",
        name: "newAddress",
        type: "address",
      },
    ],
    stateMutability: "pure",
    type: "function",
  },
];

export class IContractDeployer__factory {
  static readonly abi = _abi;
  static createInterface(): IContractDeployerInterface {
    return new utils.Interface(_abi) as IContractDeployerInterface;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): IContractDeployer {
    return new Contract(address, _abi, signerOrProvider) as IContractDeployer;
  }
}
