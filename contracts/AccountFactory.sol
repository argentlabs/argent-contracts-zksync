//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";

import {ArgentAccount} from "./ArgentAccount.sol";

contract AccountFactory {
    bytes32 constant create2Prefix = keccak256("zksyncCreate2");
    bytes32 public bytecodeHash;

    constructor(bytes32 _bytecodeHash) {
        bytecodeHash = _bytecodeHash;
    }

    function deployProxyAccount(
        bytes32 _salt,
        address _implementation,
        address _signer,
        address _guardian
    ) external returns (address) {
        bytes memory data = abi.encodeWithSelector(ArgentAccount.initialize.selector, _signer, _guardian);
        return DEPLOYER_SYSTEM_CONTRACT.create2AA(_salt, bytecodeHash, 0, abi.encode(_implementation, data));
    }

    function computeCreate2Address(
        bytes32 _salt,
        address _implementation,
        address _signer
    ) public view returns (address) {
        bytes memory inputData = abi.encode(
            _implementation,
            abi.encodeWithSelector(ArgentAccount.initialize.selector, _signer)
        );

        bytes32 senderBytes = bytes32(uint256(uint160(address(this))));
        bytes32 data = keccak256(bytes.concat(create2Prefix, senderBytes, _salt, bytecodeHash, keccak256(inputData)));
        return address(uint160(uint256(data)));
    }
}
