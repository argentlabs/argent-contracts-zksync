// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import {DEPLOYER_SYSTEM_CONTRACT} from "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import {L2ContractHelper} from "@matterlabs/zksync-contracts/l2/contracts/L2ContractHelper.sol";
import {IContractDeployer} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IContractDeployer.sol";
import {SystemContractsCaller} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/SystemContractsCaller.sol";
import {SystemContractHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/SystemContractHelper.sol";

import {ArgentAccount} from "./ArgentAccount.sol";

/// @title The factory that deploys proxies to the `ArgentAccount`
/// @dev This is hopefully a temporary solution until the Era protocol allows users to pay for the gas fees of their
/// own account's deployment, without a need for a factory.
contract AccountFactory {
    /// The hash of the bytecode of the `Proxy` contract
    bytes32 public proxyBytecodeHash;

    constructor(bytes32 _proxyBytecodeHash) {
        proxyBytecodeHash = _proxyBytecodeHash;
    }

    /// Deploys a new account via the `create2Account` system call, then initializes
    /// it by calling the `ArgentAccount.initialize` method
    function deployProxyAccount(
        bytes32 _salt,
        address _implementation,
        address _owner,
        address _guardian
    ) external returns (address _accountAddress) {
        bytes memory input = proxyContructorData(_implementation, _owner, _guardian);
        bytes memory deployData = abi.encodeCall(
            DEPLOYER_SYSTEM_CONTRACT.create2Account,
            (_salt, proxyBytecodeHash, input, IContractDeployer.AccountAbstractionVersion.Version1)
        );
        bytes memory returnData = SystemContractsCaller.systemCallWithPropagatedRevert(
            uint32(gasleft()),
            address(DEPLOYER_SYSTEM_CONTRACT),
            0,
            deployData
        );

        (_accountAddress) = abi.decode(returnData, (address));
    }

    /// Computes the address of an account that will be deployed by `deployProxyAccount` with the same arguments
    function computeCreate2Address(
        bytes32 _salt,
        address _implementation,
        address _owner,
        address _guardian
    ) public view returns (address) {
        bytes32 inputHash = keccak256(proxyContructorData(_implementation, _owner, _guardian));
        return L2ContractHelper.computeCreate2Address(address(this), _salt, proxyBytecodeHash, inputHash);
    }

    /// Returns the `_data` argument for the `Proxy` constructor
    function proxyContructorData(
        address _implementation,
        address _owner,
        address _guardian
    ) public pure returns (bytes memory) {
        bytes memory initData = abi.encodeCall(ArgentAccount.initialize, (_owner, _guardian));
        return abi.encode(_implementation, initData);
    }
}
