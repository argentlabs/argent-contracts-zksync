// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import {EfficientCall} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/EfficientCall.sol";

interface IProxy {
    /// @notice Returns the implementation of the proxy
    /// @return The address of implementation contract
    function implementation() external view returns (address);
}

/// @title A proxy contract inspired by OpenZeppelin's `Proxy` contract,
/// except it makes use of Era's more efficient delegatecall facilites
/// @notice This contract is intented to be deployed via the `create2Account` system call via the `AccountFactory`
contract Proxy is IProxy {
    /// @inheritdoc IProxy
    address public implementation;

    /// @param _implementation The address of the implementation to which calls are delegated
    /// @param _data Call data for the post-deployment initialization of the contract
    constructor(address _implementation, bytes memory _data) {
        implementation = _implementation;
        (bool success, ) = _implementation.delegatecall(_data);
        require(success, "argent/proxy-init-failed");
    }

    fallback() external payable {
        _delegate();
    }

    receive() external payable {
        _delegate();
    }

    function _delegate() private {
        bool result = EfficientCall.rawDelegateCall(gasleft(), implementation, msg.data);
        assembly {
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 {
                revert(0, returndatasize())
            }
            default {
                return(0, returndatasize())
            }
        }
    }
}
