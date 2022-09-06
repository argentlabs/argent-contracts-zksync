//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.16;

import {DEPLOYER_SYSTEM_CONTRACT} from "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import {L2ContractHelper} from "@matterlabs/zksync-contracts/l2/contracts/L2ContractHelper.sol";

import {ArgentAccount} from "./ArgentAccount.sol";

contract AccountFactory {
    bytes32 public proxyBytecodeHash;
    address public manager;

    modifier onlyManager() {
        require(msg.sender == manager, "argent/only-manager");
        _;
    }

    constructor(bytes32 _proxyBytecodeHash, address _manager) {
        require(_manager != address(0), "argent/null-manager");
        proxyBytecodeHash = _proxyBytecodeHash;
        manager = _manager;
    }

    function deployProxyAccount(
        bytes32 _salt,
        address _implementation,
        address _owner,
        address _guardian
    ) external onlyManager returns (address _newAddress) {
        bytes memory input = proxyContructorData(_implementation, _owner, _guardian);
        bytes memory revertData;
        (_newAddress, revertData) = DEPLOYER_SYSTEM_CONTRACT.create2Account(_salt, proxyBytecodeHash, 0, input);
        if (revertData.length > 0) {
            assembly {
                returndatacopy(0, 0, returndatasize())
                revert(0, returndatasize())
            }
        }
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
