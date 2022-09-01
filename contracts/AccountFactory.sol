//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.16;

import {DEPLOYER_SYSTEM_CONTRACT} from "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";

import {ArgentAccount} from "./ArgentAccount.sol";

contract AccountFactory {
    bytes32 constant create2Prefix = keccak256("zksyncCreate2");
    bytes32 public proxyBytecodeHash;

    constructor(bytes32 _proxyBytecodeHash) {
        proxyBytecodeHash = _proxyBytecodeHash;
    }

    function deployProxyAccount(
        bytes32 _salt,
        address _implementation,
        address _owner,
        address _guardian
    ) external returns (address _newAddress) {
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
        bytes memory input = proxyContructorData(_implementation, _owner, _guardian);

        bytes32 senderBytes = bytes32(uint256(uint160(address(this))));
        bytes32 data = keccak256(bytes.concat(create2Prefix, senderBytes, _salt, proxyBytecodeHash, keccak256(input)));
        return address(uint160(uint256(data)));
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
