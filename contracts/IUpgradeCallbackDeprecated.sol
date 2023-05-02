// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;
import {ArgentAccount} from "./ArgentAccount.sol";

interface IUpgradeCallbackDeprecated {
    /// @dev Deprecated, only to be used when coming from version 0.1.0.
    /// Otherwise similar to executeAfterUpgrade from IUpgradeCallback, but receives a version instead of an implementation
    function executeAfterUpgrade(ArgentAccount.Version memory _previousVersion, bytes calldata _data) external;
}
