// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import {ArgentAccount} from "../ArgentAccount.sol";

interface TypechainDummy {
    function foo(ArgentAccount.Escape memory _escape) external;
}
