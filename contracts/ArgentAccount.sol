//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "./system-contracts/DefaultAA.sol";

contract ArgentAccount is DefaultAccountAbstraction {
    address public signer;

    constructor(address _signer) {
        signer = _signer;
    }
}
