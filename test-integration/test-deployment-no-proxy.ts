import "@nomiclabs/hardhat-ethers";
import hre, { ethers } from "hardhat";
import { utils, Wallet, EIP712Signer, ContractFactory } from "zksync-web3";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";

describe("Argent Account (No Proxy)", () => {
  let signer: Wallet;
  let guardian: Wallet;

  let deployer: Deployer;
  let accountFactory: ContractFactory;

  before(async () => {
    // Initialize the wallet
    signer = new Wallet(process.env.PRIVATE_KEY as string);
    guardian = new Wallet(process.env.GUARDIAN_PRIVATE_KEY as string);

    // Create deployer object and load the artifact of the contract we want to deploy.
    deployer = new Deployer(hre, signer);
    const { abi, bytecode } = await deployer.loadArtifact("ArgentAccountNoProxy");

    accountFactory = new ContractFactory(abi, bytecode, deployer.zkWallet, "createAA");
  });

  it("Should deploy a new ArgentAccountNoProxy and send a test transaction", async () => {
    console.log(`Signer address is ${signer.address}`);

    const account1 = await accountFactory.deploy(signer.address, guardian.address);
    await account1.deployed();
    console.log(`Account 1 was deployed to ${account1.address}`);

    const transferHandle = await deployer.zkWallet.transfer({
      to: account1.address,
      amount: ethers.utils.parseEther("0.001"),
      overrides: {},
    });
    await transferHandle.wait();

    const transferTx = {
      to: "0x3274aAb2ebBF7F397d08EAaA89880426Dd3daAdD",
      value: ethers.utils.parseEther("0.00002662"),
    };

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
