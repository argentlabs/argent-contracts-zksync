import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ZkSyncArtifact } from "@matterlabs/hardhat-zksync-deploy/dist/types";
import { BytesLike } from "ethers";
import * as zksync from "zksync-web3";
import { AccountFactory, ArgentAccount } from "../typechain-types";
import { Signatories } from "./signer.service";

export interface IConfig {
  escapeSecurityPeriodInSeconds: number;
  implementation: string;
  factory: string;
  dummyAccount: string;
  testDapp: string;
}

export interface ArgentInfrastructure {
  deployer: Deployer;
  artifacts: ArgentArtifacts;
  implementation: zksync.Contract;
  factory: AccountFactory;
  dummyAccount: ArgentAccount;
}

export interface ArgentArtifacts {
  implementation: ZkSyncArtifact;
  factory: ZkSyncArtifact;
  proxy: ZkSyncArtifact;
  testDapp: ZkSyncArtifact;
}

export interface AccountDeploymentParams {
  argent: Omit<ArgentInfrastructure, "dummyAccount">;
  ownerAddress: string;
  guardianAddress: string;
  connect?: Signatories;
  funds?: false | string;
  salt?: BytesLike;
}
