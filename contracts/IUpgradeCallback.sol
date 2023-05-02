// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

interface IUpgradeCallback {
    /// @dev Logic to execute after an upgrade.
    /// Can only be called by the account after a call to `upgrade`.
    //  @param _oldImplementation Address of the previous account implementation
    //  @param _data Generic call data that can be passed to the method for future upgrade logic
    function executeAfterUpgrade(address _oldImplementation, bytes calldata _data) external;
}
