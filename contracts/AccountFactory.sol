//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.16;

import {DEPLOYER_SYSTEM_CONTRACT} from "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import {L2ContractHelper} from "@matterlabs/zksync-contracts/l2/contracts/L2ContractHelper.sol";
import {IContractDeployer} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IContractDeployer.sol";
import {SystemContractsCaller} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/SystemContractsCaller.sol";
import {SystemContractHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/SystemContractHelper.sol";

import {ArgentAccount} from "./ArgentAccount.sol";

contract AccountFactory {
    bytes32 public proxyBytecodeHash;

    constructor(bytes32 _proxyBytecodeHash) {
        proxyBytecodeHash = _proxyBytecodeHash;
    }

    function deployProxyAccount(
        bytes32 _salt,
        address _implementation,
        address _owner,
        address _guardian
    ) external returns (address _accountAddress) {
        bytes memory input = proxyContructorData(_implementation, _owner, _guardian);
        IContractDeployer.AccountAbstractionVersion version = IContractDeployer.AccountAbstractionVersion.Version1;
        bytes memory deployData = abi.encodeCall(
            DEPLOYER_SYSTEM_CONTRACT.create2Account,
            (_salt, proxyBytecodeHash, input, version)
        );
        bytes memory returnData = SystemContractsCaller.systemCallWithPropagatedRevert(
            uint32(gasleft()),
            address(DEPLOYER_SYSTEM_CONTRACT),
            0,
            deployData
        );

        (_accountAddress) = abi.decode(returnData, (address));
    }

    function computeCreate2Address(
        bytes32 _salt,
        address _implementation,
        address _owner,
        address _guardian
    ) public view returns (address) {
        bytes32 inputHash = keccak256(proxyContructorData(_implementation, _owner, _guardian));
        return L2ContractHelper.computeCreate2Address(address(this), _salt, proxyBytecodeHash, inputHash);
    }

    function proxyContructorData(
        address _implementation,
        address _owner,
        address _guardian
    ) public pure returns (bytes memory) {
        bytes memory initData = abi.encodeCall(ArgentAccount.initialize, (_owner, _guardian));
        return abi.encode(_implementation, initData);
    }
}
