//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.18;

interface IMulticall {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    function multicall(Call[] calldata _calls) external returns (bytes[] memory returnData);
}
