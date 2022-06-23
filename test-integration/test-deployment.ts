import "@nomiclabs/hardhat-ethers";
import hre, { ethers } from "hardhat";
import {
  utils,
  Wallet,
  EIP712Signer,
  ContractFactory,
  Contract,
} from "zksync-web3";
import { ETH_ADDRESS } from "zksync-web3/build/src/utils";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ZkSyncArtifact } from "@matterlabs/hardhat-zksync-deploy/dist/types";

describe("Argent Account", () => {
  let signer: Wallet;
  let deployer: Deployer;
  let accountArtifact: ZkSyncArtifact;
  let proxyFactory: ContractFactory;
  let accountImplementation: string;
  let proxy1: Contract;
  let proxy2: Contract;

  const initdata = (signer: string) => {
    const accountInterface = new ethers.utils.Interface(accountArtifact.abi);
    return accountInterface.encodeFunctionData("initialize", [signer]);
  };

  const logBalance = async (address: string) => {
    const balance = await deployer.zkWallet.provider.getBalance(address);
    console.log(
      `${address} ETH L2 balance is ${ethers.utils.formatEther(balance)}`
    );
  };

  before(async () => {
    // Initialize the wallet
    signer = new Wallet(process.env.PRIVATE_KEY as string);

    // Create deployer object and load the artifact of the contract we want to deploy.
    deployer = new Deployer(hre, signer);
    accountArtifact = await deployer.loadArtifact("ArgentAccount");
    const { abi, bytecode } = await deployer.loadArtifact("Proxy");

    proxyFactory = new ContractFactory(
      abi,
      bytecode,
      deployer.zkWallet,
      "createAA"
    );
  });

  it("Should deploy a new ArgentAccount implementation", async () => {
    const accountContract = await deployer.deploy(accountArtifact, []);
    accountImplementation = accountContract.address;
    console.log(
      `Account Implementation was deployed to ${accountImplementation}`
    );
  });

  it("Should deploy a new Proxy Account (1)", async () => {
    proxy1 = await proxyFactory.deploy(
      accountImplementation,
      initdata(signer.address)
    );
    await proxy1.deployed();
    console.log(`Proxy 1 was deployed to ${proxy1.address}`);
  });

  it("Should deploy a new Proxy Account (2)", async () => {
    proxy2 = await proxyFactory.deploy(
      accountImplementation,
      initdata("0x3274aAb2ebBF7F397d08EAaA89880426Dd3daAdD")
    );
    await proxy2.deployed();
    console.log(`Proxy 2 was deployed to ${proxy2.address}`);
  });

  it("Should fund Proxy 1 from signer key", async () => {
    const transferHandle = await deployer.zkWallet.transfer({
      to: proxy1.address,
      amount: ethers.utils.parseEther("0.0001"),
      overrides: {},
    });
    await transferHandle.wait();

    await logBalance(proxy1.address);
    await logBalance(proxy2.address);
  });

  it("Should transfer ETH from Proxy 1 to Proxy 2", async () => {
    const { provider } = deployer.zkWallet;
    const { chainId } = await provider.getNetwork();
    const transferTx = {
      to: proxy2.address,
      value: ethers.utils.parseEther("0.00002668"),
    };
    const unsignedTx = {
      ...transferTx,
      type: utils.EIP712_TX_TYPE,
      chainId,
      gasPrice: await provider.getGasPrice(),
      gasLimit: await provider.estimateGas(transferTx),
      nonce: 0,
      data: "0x",
      customData: {
        ergsPerPubdata: 0,
        feeToken: ETH_ADDRESS,
      },
    };

    const eip712Signer = new EIP712Signer(signer, chainId);
    const signature = await eip712Signer.sign(unsignedTx);

    const txRequest = {
      ...unsignedTx,
      customData: {
        ...unsignedTx.customData,
        aaParams: {
          from: proxy1.address,
          signature,
        },
      },
    };

    const serializedTx = utils.serialize(txRequest);

    const sentTx = await provider.sendTransaction(serializedTx);
    console.log(`Tx Hash is ${sentTx.hash}`);
    await sentTx.wait();

    await logBalance(proxy1.address);
    await logBalance(proxy2.address);
  });

  it("Should fail transfer ETH from Proxy 2 to Proxy 1", async () => {
    const { provider } = deployer.zkWallet;
    const { chainId } = await provider.getNetwork();
    const transferTx = {
      to: proxy1.address,
      value: ethers.utils.parseEther("0.00000668"),
    };
    const unsignedTx = {
      ...transferTx,
      type: utils.EIP712_TX_TYPE,
      chainId,
      gasPrice: await provider.getGasPrice(),
      gasLimit: await provider.estimateGas(transferTx),
      nonce: 0,
      data: "0x",
      customData: {
        ergsPerPubdata: 0,
        feeToken: ETH_ADDRESS,
      },
    };

    const eip712Signer = new EIP712Signer(signer, chainId);
    const signature = await eip712Signer.sign(unsignedTx);

    const txRequest = {
      ...unsignedTx,
      customData: {
        ...unsignedTx.customData,
        aaParams: {
          from: proxy2.address,
          signature,
        },
      },
    };

    const serializedTx = utils.serialize(txRequest);

    try {
      const sentTx = await provider.sendTransaction(serializedTx);
      console.log(`Tx Hash is ${sentTx.hash}`);
      await sentTx.wait();
    } catch (error) {
      console.log(`Transfer failed`);
    }
  });
});
