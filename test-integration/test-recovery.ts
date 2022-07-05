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
import { Interface } from "ethers/lib/utils";

describe("Recovery", () => {
  let signer: Wallet;
  let guardian: Wallet;
  let deployer: Deployer;
  let accountArtifact: ZkSyncArtifact;
  let accountInterface: Interface;
  let proxyFactory: ContractFactory;
  let accountImplementation: string;
  let proxy: Contract;
  let account: Contract;

  const initdata = (signer: string, guardian: string) => {
    return accountInterface.encodeFunctionData("initialize", [signer, guardian]);
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
    guardian = new Wallet(process.env.GUARDIAN_PRIVATE_KEY as string);
    console.log("signer", signer.address);
    console.log("guardian", guardian.address);

    // Create deployer object and load the artifact of the contract we want to deploy.
    deployer = new Deployer(hre, signer);
    accountArtifact = await deployer.loadArtifact("ArgentAccount");
    accountInterface = new ethers.utils.Interface(accountArtifact.abi);

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
    proxy = await proxyFactory.deploy(
      accountImplementation,
      initdata(signer.address, guardian.address)
    );
    await proxy.deployed();
    console.log(`Proxy 1 was deployed to ${proxy.address}`);

    account = new Contract(
      proxy.address,
      accountArtifact.abi,
      deployer.zkWallet.provider,
    );
  });

  it("Should fund Proxy 1 from signer key", async () => {
    const transferHandle = await deployer.zkWallet.transfer({
      to: proxy.address,
      amount: ethers.utils.parseEther("0.0001"),
      overrides: {},
    });
    await transferHandle.wait();

    await logBalance(proxy.address);
  });

  it("Should call a recovery method", async () => {
    console.log("guardian before", await account.guardian());
    const transferTx = {
      to: proxy.address,
      value: "0",
      data: accountInterface.encodeFunctionData("changeGuardian", ["0x3333333333333333333333333333333333333333"]),
    };

    const { provider } = deployer.zkWallet;
    const { chainId } = await provider.getNetwork();
    const gasLimit = (await provider.estimateGas({ ...transferTx, from: proxy.address })).add("20000");
    console.log("gasLimit", gasLimit);
    const unsignedTx = {
      ...transferTx,
      type: utils.EIP712_TX_TYPE,
      chainId,
      gasPrice: await provider.getGasPrice(),
      gasLimit: ethers.BigNumber.from("300000"),
      // gasLimit: gasLimit,
      nonce: await provider.getTransactionCount(proxy.address),
      customData: {
        ergsPerPubdata: 0,
        feeToken: ETH_ADDRESS,
      },
    };
    // console.log("unsignedTx", unsignedTx);

    const signerSignature = await new EIP712Signer(signer, chainId).sign(unsignedTx);
    const guardianSignature = await new EIP712Signer(guardian, chainId).sign(unsignedTx);
    const signature = ethers.utils.concat([signerSignature, guardianSignature]);
    console.log("signature1", signerSignature);
    console.log("signature2", guardianSignature);
    console.log("signature ", signature.length, ethers.utils.hexlify(signature));

    /*
    const signedTxHash = EIP712Signer.getSignedDigest(unsignedTx);
    const demoSignature = ethers.utils.concat([
      // Note, that `signMessage` wouldn't work here, since we don't want
      // the signed hash to be prefixed with `\x19Ethereum Signed Message:\n`
      ethers.utils.joinSignature(signer._signingKey().signDigest(signedTxHash)),
      ethers.utils.joinSignature(guardian._signingKey().signDigest(signedTxHash)),
    ])

    console.log("signature1", ethers.utils.joinSignature(signer._signingKey().signDigest(signedTxHash)));
    console.log("signature2", ethers.utils.joinSignature(guardian._signingKey().signDigest(signedTxHash)));
    console.log("signature ", demoSignature.length, ethers.utils.hexlify(demoSignature));
    */

    const txRequest = {
      ...unsignedTx,
      customData: {
        ...unsignedTx.customData,
        aaParams: {
          from: proxy.address,
          signature,
        },
      },
    };
    // console.log("txRequest", txRequest);

    const serializedTx = utils.serialize(txRequest);
    const sentTx = await provider.sendTransaction(serializedTx);
    console.log(`Tx Hash is ${sentTx.hash}`);
    await sentTx.wait();

    await logBalance(account.address);
    console.log("guardian after", await account.guardian())
  });

});
