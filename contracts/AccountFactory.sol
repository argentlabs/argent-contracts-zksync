//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./system-contracts/Constants.sol";

contract AccountFactory {
    bytes32 public bytecodeHash;

    constructor(bytes32 _bytecodeHash) {
        bytecodeHash = _bytecodeHash;
    }

    function deployProxyAccount(
        bytes32 _salt,
        address _implementation,
        bytes memory _data
    ) external returns (address) {
        return
            DEPLOYER_SYSTEM_CONTRACT.create2AA(
                _salt,
                bytecodeHash,
                0,
                abi.encode(_implementation, _data)
            );
    }
}
