import "@nomicfoundation/hardhat-chai-matchers";
import "@nomiclabs/hardhat-ethers";
import { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { getDeployer } from "../src/deployer.service";
import { ArgentAccount } from "../typechain-types/contracts/test/TypechainDummy";

export type EscapeStruct = ArgentAccount.EscapeStruct;

export const owner = zksync.Wallet.createRandom();
export const guardian = zksync.Wallet.createRandom();
export const guardianBackup = zksync.Wallet.createRandom();
export const wrongOwner = zksync.Wallet.createRandom();
export const wrongGuardian = zksync.Wallet.createRandom();
export const newOwner = zksync.Wallet.createRandom();
export const newGuardian = zksync.Wallet.createRandom();
export const newGuardianBackup = zksync.Wallet.createRandom();
export const other = zksync.Wallet.createRandom();

export const ownerAddress = owner.address;
export const guardianAddress = guardian.address;

export const { AddressZero } = ethers.constants;
export const { deployer, deployerAddress, provider } = getDeployer();

console.log(`owner private key: ${owner.privateKey} (${ownerAddress})`);
console.log(`guardian private key: ${guardian.privateKey} (${guardianAddress})`);
