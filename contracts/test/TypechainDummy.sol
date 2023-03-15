// SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.0;

import {ArgentAccount} from "../ArgentAccount.sol";

interface TypechainDummy {
    function foo(ArgentAccount.Escape calldata escape) external;
}
