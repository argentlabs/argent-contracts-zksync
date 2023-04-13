import { BigNumberish, BytesLike, ethers } from "ethers";

type Provider = ethers.providers.Provider;
type TransactionRequest = ethers.providers.TransactionRequest;
type TransactionReceipt = ethers.providers.TransactionReceipt;

export interface Call {
  to?: string;
  value?: BigNumberish;
  data?: BytesLike;
}

export type Result =
  | { isMulticall: boolean; isError: false; receipt: TransactionReceipt }
  | { isMulticall: boolean; isError: true; error: Error };

const multicallInterface = new ethers.utils.Interface([
  "function multicall(tuple(address to, uint256 value, bytes data)[] _calls)",
]);

const erc165Interface = new ethers.utils.Interface([
  "function supportsInterface(bytes4 _interfaceId) external view returns (bool)",
]);

export const multicall = async (
  signer: ethers.Signer,
  calls: Call[],
  overrides: ethers.Overrides = {},
): Promise<Result[]> => {
  if (!signer.provider) {
    throw new Error("Signer has no provider");
  }
  const from = await signer.getAddress();
  const transactions = await prepareCalls(signer.provider, from, calls);
  const isMulticall = transactions.length === 1 && calls.length > 1;

  const results: Result[] = [];
  for (const transaction of transactions) {
    try {
      const response = await signer.sendTransaction({ from, ...transaction, ...overrides });
      const receipt = await response.wait();
      results.push({ isMulticall, isError: false, receipt });
    } catch (error: any) {
      results.push({ isMulticall, isError: true, error });
    }
  }
  return results;
};

const prepareCalls = async (provider: Provider, to: string, calls: Call[]): Promise<TransactionRequest[]> => {
  if (calls.length === 0) {
    throw new Error("No calls provided");
  }
  if (calls.length === 1) {
    return calls;
  }

  const isContract = await isContractAddress(provider, to);
  const isSupported = isContract && (await supportsMulticall(provider, to));
  if (!isSupported) {
    return calls;
  }

  calls = calls.map((call) => ({
    to: call.to,
    value: call.value ?? ethers.constants.Zero,
    data: call.data ?? [],
  }));
  const data = multicallInterface.encodeFunctionData("multicall", [calls]);
  return [{ to, value: ethers.constants.Zero, data }];
};

export const supportsMulticall = async (provider: Provider, address: string): Promise<boolean> => {
  const interfaceId = multicallInterface.getSighash("multicall");
  return supportsInterface(provider, address, interfaceId);
};

const supportsInterface = async (provider: Provider, address: string, interfaceId: string): Promise<boolean> => {
  const contract = new ethers.Contract(address, erc165Interface, provider);
  return await contract.callStatic.supportsInterface(interfaceId);
};

const isContractAddress = async (provider: Provider, address: string): Promise<boolean> => {
  const code = await provider.getCode(address);
  return ethers.utils.arrayify(code).length !== 0;
};
