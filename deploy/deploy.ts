import { utils, Wallet, EIP712Signer, ContractFactory } from "zksync-web3";
import * as ethers from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { Deployer } from "@matterlabs/hardhat-zksync-deploy";
import { ETH_ADDRESS } from "zksync-web3/build/src/utils";

const logBalance = async (address: string, provider: Provider) => {
  const balance = await provider.getBalance(address);
  console.log(`${address} ETH L2 balance is ${ethers.utils.formatEther(balance)}`);
};

export default async function (hre: HardhatRuntimeEnvironment) {
  // Initialize the wallet
  const signer = new Wallet(process.env.PRIVATE_KEY as string);
  const signerAddress = await signer.getAddress();
  console.log(`Signer address is ${signerAddress}`);

  // Create deployer object and load the artifact of the contract we want to deploy.
  const deployer = new Deployer(hre, signer);
  const accountArtifact = await deployer.loadArtifact("ArgentAccount");
  const { provider } = deployer.zkWallet;

  const { chainId } = await provider.getNetwork();

  const accountFactory = new ContractFactory(
    accountArtifact.abi,
    accountArtifact.bytecode,
    deployer.zkWallet,
    "createAA",
  );

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

  console.log(txRequest);
  const serializedTx = utils.serialize({ ...txRequest });

  const sentTx = await provider.sendTransaction(serializedTx);
  console.log(sentTx.hash);
  await sentTx.wait();
}
