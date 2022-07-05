import "@nomiclabs/hardhat-ethers";
import hre, { ethers } from "hardhat";
import { utils, Wallet, EIP712Signer, Contract } from "zksync-web3";
import { ETH_ADDRESS } from "zksync-web3/build/src/utils";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";

const accountInterface = new ethers.utils.Interface([
  "function initialize(address _signer)",
  "event AccountCreated(address account, address signer)",
]);

const getAccountAddressFromCreate2 = (
  factoryAddress: string,
  bytecodeHash: Uint8Array,
  implementation: string,
  salt: string,
  signerAddress: string,
): string => {
  const abiCoder = new ethers.utils.AbiCoder();
  const data = accountInterface.encodeFunctionData("initialize", [signerAddress]);
  return utils.create2Address(
    factoryAddress,
    bytecodeHash,
    salt,
    abiCoder.encode(["address", "bytes"], [implementation, data]),
  );
};

const getAccountAddressFromFactory = async (
  accountFactory: Contract,
  implementation: string,
  salt: string,
  signerAddress: string,
) => {
  return await accountFactory.functions.computeCreate2Address(salt, implementation, signerAddress);
};

describe("Argent Account", () => {
  let signer: Wallet;
  let deployer: Deployer;

  let accountImplementation: string;
  let accountFactory: Contract;
  let proxyBytecodeHash: Uint8Array;

  let proxy1: string;
  let proxy2: string;

  const deployAccount = async (signerAddress: string): Promise<string> => {
    const salt = ethers.constants.HashZero;

    const predictedAddress = await getAccountAddressFromFactory(
      accountFactory,
      accountImplementation,
      salt,
      signerAddress,
    );
    console.log(`Predicted address from factory: ${predictedAddress}`);

    const tx = await accountFactory.deployProxyAccount(salt, accountImplementation, signerAddress);
    const receipt = await tx.wait();

    const [{ deployedAddress }] = utils.getDeployedContracts(receipt);
    const create2Address = getAccountAddressFromCreate2(
      accountFactory.address,
      proxyBytecodeHash,
      accountImplementation,
      salt,
      signerAddress,
    );

    if (deployedAddress !== create2Address) {
      throw new Error(`Address from log ${deployedAddress} != address from create2 ${create2Address}`);
    }

    return deployedAddress;
  };

  const logBalance = async (address: string) => {
    const balance = await deployer.zkWallet.provider.getBalance(address);
    console.log(`${address} ETH L2 balance is ${ethers.utils.formatEther(balance)}`);
  };

  before(async () => {
    // Initialize the wallet
    signer = new Wallet(process.env.PRIVATE_KEY as string);

    // Create deployer object and load the artifact of the contract we want to deploy.
    deployer = new Deployer(hre, signer);
  });

  it("Should deploy a new ArgentAccount implementation", async () => {
    const artifact = await deployer.loadArtifact("ArgentAccount");
    const accountContract = await deployer.deploy(artifact, []);
    accountImplementation = accountContract.address;
    console.log(`Account Implementation was deployed to ${accountImplementation}`);
  });

  it("Should deploy a new AccountFactory", async () => {
    const artifact = await deployer.loadArtifact("AccountFactory");
    const { bytecode } = await deployer.loadArtifact("Proxy");
    proxyBytecodeHash = utils.hashBytecode(bytecode);
    accountFactory = await deployer.deploy(artifact, [proxyBytecodeHash], undefined, [bytecode]);
    console.log(`Account Factory was deployed to ${accountFactory.address}`);
  });

  it("Should deploy a new Proxy Account (1)", async () => {
    proxy1 = await deployAccount(signer.address);
    console.log(`Proxy1 deployed at ${proxy1}`);
  });

  it("Should deploy a new Proxy Account (2)", async () => {
    proxy2 = await deployAccount("0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8");
    console.log(`Proxy2 deployed at ${proxy2}`);
  });

  it("Should fund Proxy 1 from signer key", async () => {
    const transferHandle = await deployer.zkWallet.transfer({
      to: proxy1,
      amount: ethers.utils.parseEther("0.0001"),
      overrides: {},
    });
    await transferHandle.wait();

    await logBalance(proxy1);
    await logBalance(proxy2);
  });

  it("Should transfer ETH from Proxy 1 to Proxy 2", async () => {
    const { provider } = deployer.zkWallet;
    const { chainId } = await provider.getNetwork();
    const transferTx = {
      to: proxy2,
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
          from: proxy1,
          signature,
        },
      },
    };

    const serializedTx = utils.serialize(txRequest);

    const sentTx = await provider.sendTransaction(serializedTx);
    console.log(`Tx Hash is ${sentTx.hash}`);
    await sentTx.wait();

    await logBalance(proxy1);
    await logBalance(proxy2);
  });

  it("Should fail transfer ETH from Proxy 2 to Proxy 1", async () => {
    const { provider } = deployer.zkWallet;
    const { chainId } = await provider.getNetwork();
    const transferTx = {
      to: proxy1,
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
          from: proxy2,
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
