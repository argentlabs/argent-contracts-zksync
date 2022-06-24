//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./system-contracts/Constants.sol";

contract AccountFactory {
    bytes32 public bytecodeHash;

    bytes4 private constant INITIALIZE_SELECTOR =
        bytes4(keccak256("initialize(address)"));

    constructor(bytes32 _bytecodeHash) {
        bytecodeHash = _bytecodeHash;
    }

    function deployProxyAccount(
        bytes32 _salt,
        address _implementation,
        address _signer
    ) external returns (address) {
        bytes memory data = abi.encodeWithSelector(
            INITIALIZE_SELECTOR,
            _signer
        );
        return
            DEPLOYER_SYSTEM_CONTRACT.create2AA(
                _salt,
                bytecodeHash,
                0,
                abi.encode(_implementation, data)
            );
    }
}
