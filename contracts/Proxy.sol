// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import {EfficientCall} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/EfficientCall.sol";

interface IProxy {
    /// @notice Returns the implementation of the account
    /// @return The account implementation
    function implementation() external view returns (address);
}

/// @title The proxy contract that folds user funds
/// @notice This contract is deployed via the `create2Account` system call via the `AccountFactory`
contract Proxy is IProxy {
    /// @inheritdoc IProxy
    address public implementation;

    /// @notice Creates a new user account
    /// @param _implementation The address of the `ArgentAccount` implementation
    /// @param _data Call data for the post-deployment initialization of the account
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

    /// @notice Inspired by OpenZeppelin's `Proxy` contract, except it makes use of
    /// Era's more efficient delegatecall facilites
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
