import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ZkSyncArtifact } from "@matterlabs/hardhat-zksync-deploy/dist/types";
import { BytesLike, ethers } from "ethers";
import * as zksync from "zksync-web3";
import { AccountFactory } from "../typechain-types";
import { Signatory } from "./signer.service";

export type TransactionRequest = zksync.types.TransactionRequest;
export type TransactionResponse = zksync.types.TransactionResponse;
export type TransactionReceipt = zksync.types.TransactionReceipt;

export enum EscapeType {
  None,
  Guardian,
  Owner,
}

export enum EscapeStatus {
  None,
  NotReady,
  Ready,
  Expired,
}

export interface IConfig {
  escapeSecurityPeriodInSeconds: number;
  implementation: string;
  factory: string;
  testDapp: string;
}

export interface ArgentInfrastructure {
  deployer: Deployer;
  artifacts: ArgentArtifacts;
  implementation: zksync.Contract;
  factory: AccountFactory;
}

export interface ArgentArtifacts {
  implementation: ZkSyncArtifact;
  factory: ZkSyncArtifact;
  proxy: ZkSyncArtifact;
  testDapp: ZkSyncArtifact;
}

export interface ProxyAccountDeploymentParams {
  argent: ArgentInfrastructure;
  ownerAddress: string;
  guardianAddress: string;
  salt?: BytesLike;
  overrides?: ethers.Overrides;
}

export interface AccountDeploymentParams extends ProxyAccountDeploymentParams {
  connect?: Signatory[];
  funds?: false | string;
}
