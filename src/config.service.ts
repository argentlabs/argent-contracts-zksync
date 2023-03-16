import fs from "fs";
import hre from "hardhat";
import { IConfig } from "./model";

export const loadConfig = async (): Promise<IConfig> => {
  try {
    return JSON.parse(fs.readFileSync(`./config/${hre.network.name}.json`, "utf8"));
  } catch {
    throw new Error(`No config for network ${hre.network.name}`);
  }
};

export const saveConfig = async (newConfig: Partial<IConfig>) => {
  if (hre.network.name === "local") {
    return;
  }
  const config = await loadConfig();
  const updated = JSON.stringify({ ...config, ...newConfig }, null, 2);
  fs.writeFileSync(`./config/${hre.network.name}.json`, updated);
};
