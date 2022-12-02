/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import type {
  EventFragment,
  FunctionFragment,
  Result,
} from "@ethersproject/abi";
import type { Listener, Provider } from "@ethersproject/providers";
import type {
  BaseContract,
  BigNumber,
  BytesLike,
  CallOverrides,
  ContractTransaction,
  Overrides,
  PopulatedTransaction,
  Signer,
  utils,
} from "ethers";
import type {
  OnEvent,
  PromiseOrValue,
  TypedEvent,
  TypedEventFilter,
  TypedListener,
} from "../../../../../common";

export interface IKnownCodesStorageInterface extends utils.Interface {
  functions: {
    "getMarker(bytes32)": FunctionFragment;
    "markFactoryDeps(bool,bytes32[])": FunctionFragment;
  };

  getFunction(
    nameOrSignatureOrTopic: "getMarker" | "markFactoryDeps"
  ): FunctionFragment;

  encodeFunctionData(
    functionFragment: "getMarker",
    values: [PromiseOrValue<BytesLike>]
  ): string;
  encodeFunctionData(
    functionFragment: "markFactoryDeps",
    values: [PromiseOrValue<boolean>, PromiseOrValue<BytesLike>[]]
  ): string;

  decodeFunctionResult(functionFragment: "getMarker", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "markFactoryDeps",
    data: BytesLike
  ): Result;

  events: {
    "MarkedAsKnown(bytes32,bool)": EventFragment;
  };

  getEvent(nameOrSignatureOrTopic: "MarkedAsKnown"): EventFragment;
}

export interface MarkedAsKnownEventObject {
  bytecodeHash: string;
  sendBytecodeToL1: boolean;
}
export type MarkedAsKnownEvent = TypedEvent<
  [string, boolean],
  MarkedAsKnownEventObject
>;

export type MarkedAsKnownEventFilter = TypedEventFilter<MarkedAsKnownEvent>;

export interface IKnownCodesStorage extends BaseContract {
  connect(signerOrProvider: Signer | Provider | string): this;
  attach(addressOrName: string): this;
  deployed(): Promise<this>;

  interface: IKnownCodesStorageInterface;

  queryFilter<TEvent extends TypedEvent>(
    event: TypedEventFilter<TEvent>,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined
  ): Promise<Array<TEvent>>;

  listeners<TEvent extends TypedEvent>(
    eventFilter?: TypedEventFilter<TEvent>
  ): Array<TypedListener<TEvent>>;
  listeners(eventName?: string): Array<Listener>;
  removeAllListeners<TEvent extends TypedEvent>(
    eventFilter: TypedEventFilter<TEvent>
  ): this;
  removeAllListeners(eventName?: string): this;
  off: OnEvent<this>;
  on: OnEvent<this>;
  once: OnEvent<this>;
  removeListener: OnEvent<this>;

  functions: {
    getMarker(
      _hash: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<[BigNumber]>;

    markFactoryDeps(
      _shouldSendToL1: PromiseOrValue<boolean>,
      _hashes: PromiseOrValue<BytesLike>[],
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<ContractTransaction>;
  };

  getMarker(
    _hash: PromiseOrValue<BytesLike>,
    overrides?: CallOverrides
  ): Promise<BigNumber>;

  markFactoryDeps(
    _shouldSendToL1: PromiseOrValue<boolean>,
    _hashes: PromiseOrValue<BytesLike>[],
    overrides?: Overrides & { from?: PromiseOrValue<string> }
  ): Promise<ContractTransaction>;

  callStatic: {
    getMarker(
      _hash: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    markFactoryDeps(
      _shouldSendToL1: PromiseOrValue<boolean>,
      _hashes: PromiseOrValue<BytesLike>[],
      overrides?: CallOverrides
    ): Promise<void>;
  };

  filters: {
    "MarkedAsKnown(bytes32,bool)"(
      bytecodeHash?: PromiseOrValue<BytesLike> | null,
      sendBytecodeToL1?: PromiseOrValue<boolean> | null
    ): MarkedAsKnownEventFilter;
    MarkedAsKnown(
      bytecodeHash?: PromiseOrValue<BytesLike> | null,
      sendBytecodeToL1?: PromiseOrValue<boolean> | null
    ): MarkedAsKnownEventFilter;
  };

  estimateGas: {
    getMarker(
      _hash: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    markFactoryDeps(
      _shouldSendToL1: PromiseOrValue<boolean>,
      _hashes: PromiseOrValue<BytesLike>[],
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<BigNumber>;
  };

  populateTransaction: {
    getMarker(
      _hash: PromiseOrValue<BytesLike>,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>;

    markFactoryDeps(
      _shouldSendToL1: PromiseOrValue<boolean>,
      _hashes: PromiseOrValue<BytesLike>[],
      overrides?: Overrides & { from?: PromiseOrValue<string> }
    ): Promise<PopulatedTransaction>;
  };
}
