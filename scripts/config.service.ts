import fs from "fs";
import hre from "hardhat";
import { IConfig } from "./model";

export type Env = "local" | "goerli";

export const getEnv = (): Env => {
  if (!process.env.NODE_ENV) {
    return "local";
  }
  return process.env.NODE_ENV as Env;
};

export const loadConfig = async (): Promise<IConfig> => {
  if (hre.network.name === "zkSyncMainnet") {
    return JSON.parse(fs.readFileSync(`./config/mainnet.json`, "utf8"));
  }
  try {
    return JSON.parse(fs.readFileSync(`./config/${getEnv()}.json`, "utf8"));
  } catch {
    return {} as IConfig;
  }
};

export const saveConfig = async (newConfig: Partial<IConfig>) => {
  const config = await loadConfig();
  const updated = JSON.stringify({ ...config, ...newConfig }, null, 2);
  fs.writeFileSync(`./config/${getEnv()}.json`, updated);
};
