//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.16;

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

    fallback() external payable {
        address target = implementation;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), target, 0, calldatasize(), 0, 0)
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

    receive() external payable {}
}
