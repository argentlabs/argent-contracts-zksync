import "@nomiclabs/hardhat-ethers";
import hre, { ethers } from "hardhat";
import {
  utils,
  Wallet,
  EIP712Signer,
  ContractFactory,
} from "zksync-web3";
import { ETH_ADDRESS } from "zksync-web3/build/src/utils";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";

describe("Argent Account (No Proxy)", () => {
  let signer: Wallet;
  let deployer: Deployer;
  let accountFactory: ContractFactory;

  before(async () => {
    // Initialize the wallet
    signer = new Wallet(process.env.PRIVATE_KEY as string);

    // Create deployer object and load the artifact of the contract we want to deploy.
    deployer = new Deployer(hre, signer);
    const { abi, bytecode } = await deployer.loadArtifact("ArgentAccountNoProxy");

    accountFactory = new ContractFactory(abi, bytecode, deployer.zkWallet, "createAA");
  });

  it("Should deploy a new ArgentAccountNoProxy and send a test transaction", async () => {
    const signerAddress = await signer.getAddress();
    console.log(`Signer address is ${signerAddress}`);

    const account1 = await accountFactory.deploy(signerAddress);
    await account1.deployed();
    console.log(`Account 1 was deployed to ${account1.address}`);

    const transferHandle = await deployer.zkWallet.transfer({
      to: account1.address,
      amount: ethers.utils.parseEther("0.001"),
      overrides: {},
    });
    await transferHandle.wait();

    const transferTx = await deployer.zkWallet.getTransferTx({
      to: "0x3274aAb2ebBF7F397d08EAaA89880426Dd3daAdD",
      amount: ethers.utils.parseEther("0.00002662"),
      overrides: {},
    });

    const { provider } = deployer.zkWallet;
    const { chainId } = await provider.getNetwork();
    const unsignedTx = {
      type: utils.EIP712_TX_TYPE,
      chainId,
      ...transferTx,
      gasPrice: await provider.getGasPrice(),
      gasLimit: await provider.estimateGas(transferTx),
      nonce: 0,
      data: "0x",
      customData: {
        ...transferTx.customData,
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
          from: account1.address,
          signature,
        },
      },
    };

    const serializedTx = utils.serialize(txRequest);

    const sentTx = await provider.sendTransaction(serializedTx);
    console.log(sentTx.hash);
    await sentTx.wait();
  });
});
