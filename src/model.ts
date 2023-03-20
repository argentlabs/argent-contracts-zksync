import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ZkSyncArtifact } from "@matterlabs/hardhat-zksync-deploy/dist/types";
import { BytesLike } from "ethers";
import * as zksync from "zksync-web3";
import { AccountFactory } from "../typechain-types";
import { Signatory } from "./signer.service";

export enum EscapeType {
  None,
  Guardian,
  Owner,
}

export enum EscapeStatus {
  None,
  Triggered,
  Active,
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

export interface AccountDeploymentParams {
  argent: ArgentInfrastructure;
  ownerAddress: string;
  guardianAddress: string;
  connect?: Signatory[];
  funds?: false | string;
  salt?: BytesLike;
}
