import "@nomiclabs/hardhat-ethers";
import hre, { ethers } from "hardhat";
import { utils, Wallet, EIP712Signer, Contract } from "zksync-web3";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ZkSyncArtifact } from "@matterlabs/hardhat-zksync-deploy/dist/types";

const accountInterface = new ethers.utils.Interface([
  "function initialize(address _signer, address _guardian)",
  "event AccountCreated(address account, address signer, address guardian)",
]);

const getAccountAddressFromCreate2 = (
  factoryAddress: string,
  bytecodeHash: Uint8Array,
  implementation: string,
  salt: string,
  signerAddress: string,
  guardianAddress: string,
): string => {
  const abiCoder = new ethers.utils.AbiCoder();
  const data = accountInterface.encodeFunctionData("initialize", [signerAddress, guardianAddress]);
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
  guardianAddress: string,
) => {
  return await accountFactory.functions.computeCreate2Address(salt, implementation, signerAddress, guardianAddress);
};

describe("Argent Account", () => {
  let signer: Wallet;
  let guardian: Wallet;
  let deployer: Deployer;

  let accountImplementation: string;
  let accountFactory: Contract;
  let proxyBytecodeHash: Uint8Array;

  let proxy1: string;
  let proxy2: string;

  before(async () => {
    signer = new Wallet(process.env.PRIVATE_KEY as string);
    guardian = new Wallet(process.env.GUARDIAN_PRIVATE_KEY as string);
    deployer = new Deployer(hre, signer);
  });

  const deployAccount = async (signerAddress: string, guardianAddress: string): Promise<string> => {
    const salt = ethers.constants.HashZero;

    const predictedAddress = await getAccountAddressFromFactory(
      accountFactory,
      accountImplementation,
      salt,
      signerAddress,
      guardianAddress,
    );
    console.log(`Predicted address from factory: ${predictedAddress}`);

    const tx = await accountFactory.deployProxyAccount(salt, accountImplementation, signerAddress, guardianAddress);
    const receipt = await tx.wait();

    const [{ deployedAddress }] = utils.getDeployedContracts(receipt);
    const create2Address = getAccountAddressFromCreate2(
      accountFactory.address,
      proxyBytecodeHash,
      accountImplementation,
      salt,
      signerAddress,
      guardianAddress,
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
    proxy1 = await deployAccount(signer.address, guardian.address);
    console.log(`Proxy1 deployed at ${proxy1}`);
  });

  it("Should deploy a new Proxy Account (2)", async () => {
    proxy2 = await deployAccount("0xEA674fdDe714fd979de3EdF0F56AA9716B898ec8", guardian.address);
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
        feeToken: utils.ETH_ADDRESS,
      },
    };

    const signature = ethers.utils.concat([
      await new EIP712Signer(signer, chainId).sign(unsignedTx),
      await new EIP712Signer(guardian, chainId).sign(unsignedTx),
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
        feeToken: utils.ETH_ADDRESS,
      },
    };

    const signature = ethers.utils.concat([
      await new EIP712Signer(signer, chainId).sign(unsignedTx),
      await new EIP712Signer(guardian, chainId).sign(unsignedTx),
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
