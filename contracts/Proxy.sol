//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.18;

import {EfficientCall} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/EfficientCall.sol";

interface IProxy {
    /**
     * @notice Returns the implementation of the account.
     * @return The account implementation.
     */
    function implementation() external view returns (address);
}

contract Proxy is IProxy {
    address public implementation;

    constructor(address _implementation, bytes memory _data) {
        implementation = _implementation;
        (bool success, ) = _implementation.delegatecall(_data);
        require(success, "argent/proxy-init-failed");
    }

    fallback(bytes calldata _data) external payable returns (bytes memory) {
        return EfficientCall.delegateCall(gasleft(), implementation, _data);
    }

    receive() external payable {}
}
