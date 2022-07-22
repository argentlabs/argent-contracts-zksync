import "@nomiclabs/hardhat-ethers";
import hre, { ethers } from "hardhat";
import * as zksync from "zksync-web3";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ArgentArtifacts, ArgentContext, deployAccount, logBalance } from "./accounts.service";

describe("Argent account", () => {
  let signer: zksync.Wallet;
  let guardian: zksync.Wallet;
  let argent: ArgentContext;

  before(async () => {
    signer = new zksync.Wallet(process.env.PRIVATE_KEY as string);
    guardian = new zksync.Wallet(process.env.GUARDIAN_PRIVATE_KEY as string);
  });

  describe("Infrastructure deployment", () => {
    let deployer: Deployer;
    let artifacts: ArgentArtifacts;
    let implementation: zksync.Contract;
    let factory: zksync.Contract;

    before(async () => {
      deployer = new Deployer(hre, signer);
      artifacts = {
        implementation: await deployer.loadArtifact("ArgentAccount"),
        factory: await deployer.loadArtifact("AccountFactory"),
        proxy: await deployer.loadArtifact("Proxy"),
      };
    });

    it("Should deploy a new ArgentAccount implementation", async () => {
      implementation = await deployer.deploy(artifacts.implementation, []);
      console.log(`Account Implementation was deployed to ${implementation.address}`);
    });

    it("Should deploy a new AccountFactory", async () => {
      const { bytecode } = artifacts.proxy;
      const proxyBytecodeHash = zksync.utils.hashBytecode(bytecode);
      factory = await deployer.deploy(artifacts.factory, [proxyBytecodeHash], undefined, [bytecode]);
      console.log(`Account Factory was deployed to ${factory.address}`);
    });

    after(async () => {
      argent = { deployer, artifacts, implementation, factory };
    });
  });

  describe("Transfers", () => {
    let proxy1: string;
    let proxy2: string;

    it("Should deploy a new Proxy Account (1)", async () => {
      proxy1 = await deployAccount(argent, signer.address, guardian.address);
      console.log(`Proxy1 deployed at ${proxy1}`);
    });

    it("Should deploy a new Proxy Account (2)", async () => {
      proxy2 = await deployAccount(argent, "0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8", guardian.address);
      console.log(`Proxy2 deployed at ${proxy2}`);
    });

    it("Should fund Proxy 1 from signer key", async () => {
      const { deployer } = argent;
      const transferHandle = await deployer.zkWallet.transfer({
        to: proxy1,
        amount: ethers.utils.parseEther("0.0001"),
        overrides: {},
      });
      await transferHandle.wait();

      await logBalance(deployer, proxy1);
      await logBalance(deployer, proxy2);
    });

    it("Should transfer ETH from Proxy 1 to Proxy 2", async () => {
      const { deployer } = argent;
      const { provider } = deployer.zkWallet;
      const { chainId } = await provider.getNetwork();
      const transferTx = {
        to: proxy2,
        value: ethers.utils.parseEther("0.00002668"),
      };
      const unsignedTx = {
        ...transferTx,
        type: zksync.utils.EIP712_TX_TYPE,
        chainId,
        gasPrice: await provider.getGasPrice(),
        gasLimit: await provider.estimateGas(transferTx),
        nonce: 0,
        data: "0x",
        customData: {
          ergsPerPubdata: 0,
          feeToken: zksync.utils.ETH_ADDRESS,
        },
      };

      const signature = ethers.utils.concat([
        await new zksync.EIP712Signer(signer, chainId).sign(unsignedTx),
        await new zksync.EIP712Signer(guardian, chainId).sign(unsignedTx),
      ]);

      const txRequest = {
        ...unsignedTx,
        customData: {
          ...unsignedTx.customData,
          aaParams: {
            from: proxy1,
            signature,
          },
        },
      };

      const serializedTx = zksync.utils.serialize(txRequest);

      const sentTx = await provider.sendTransaction(serializedTx);
      console.log(`Tx Hash is ${sentTx.hash}`);
      await sentTx.wait();

      await logBalance(deployer, proxy1);
      await logBalance(deployer, proxy2);
    });

    it("Should fail transfer ETH from Proxy 2 to Proxy 1", async () => {
      const { deployer } = argent;
      const { provider } = deployer.zkWallet;
      const { chainId } = await provider.getNetwork();
      const transferTx = {
        to: proxy1,
        value: ethers.utils.parseEther("0.00000668"),
      };
      const unsignedTx = {
        ...transferTx,
        type: zksync.utils.EIP712_TX_TYPE,
        chainId,
        gasPrice: await provider.getGasPrice(),
        gasLimit: await provider.estimateGas(transferTx),
        nonce: 0,
        data: "0x",
        customData: {
          ergsPerPubdata: 0,
          feeToken: zksync.utils.ETH_ADDRESS,
        },
      };

      const signature = ethers.utils.concat([
        await new zksync.EIP712Signer(signer, chainId).sign(unsignedTx),
        await new zksync.EIP712Signer(guardian, chainId).sign(unsignedTx),
      ]);

      const txRequest = {
        ...unsignedTx,
        customData: {
          ...unsignedTx.customData,
          aaParams: {
            from: proxy2,
            signature,
          },
        },
      };

      const serializedTx = zksync.utils.serialize(txRequest);

      try {
        const sentTx = await provider.sendTransaction(serializedTx);
        console.log(`Tx Hash is ${sentTx.hash}`);
        await sentTx.wait();
      } catch (error) {
        console.log(`Transfer failed`);
      }
    });
  });
});
