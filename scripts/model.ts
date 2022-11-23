import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ZkSyncArtifact } from "@matterlabs/hardhat-zksync-deploy/dist/types";
import { BytesLike } from "ethers";
import * as zksync from "zksync-web3";
import { ArgentAccount } from "./account.service";
import { Signatories } from "./signer.service";

export interface IConfig {
  implementation: string;
  factory: string;
  dummyAccount: string;
  testDapp: string;
  sponsoringPaymaster: string;
}

export interface ArgentInfrastructure {
  deployer: Deployer;
  artifacts: ArgentArtifacts;
  implementation: zksync.Contract;
  factory: zksync.Contract;
  dummyAccount: ArgentAccount;
  testDapp: zksync.Contract;
}

export interface ArgentArtifacts {
  implementation: ZkSyncArtifact;
  factory: ZkSyncArtifact;
  proxy: ZkSyncArtifact;
  testDapp: ZkSyncArtifact;
  sponsoringPaymaster: ZkSyncArtifact;
}

export interface AccountDeploymentParams {
  argent: Omit<ArgentInfrastructure, "dummyAccount">;
  ownerAddress: string;
  guardianAddress: string;
  connect?: Signatories;
  funds?: false | string;
  salt?: BytesLike;
}
