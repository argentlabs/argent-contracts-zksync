// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

interface IMulticall {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    /// @notice Executes the calls in sequential order, reverting if any of the calls reverts
    /// @param _calls Calls to execute
    function multicall(Call[] calldata _calls) external returns (bytes[] memory _returnData);
}
