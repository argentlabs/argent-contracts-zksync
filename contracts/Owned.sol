//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.16;

/**
 * @title Owned
 * @notice Basic contract to define an owner.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract Owned {
    // The owner
    address public owner;

    event OwnerChanged(address indexed _newOwner);

    /**
     * @notice Throws if the sender is not the owner.
     */
    modifier onlyOwner() {
        require(msg.sender == owner, "Must be owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Lets the owner transfer ownership of the contract to a new owner.
     * @param _newOwner The new owner.
     */
    function changeOwner(address _newOwner) external onlyOwner {
        _changeOwner(_newOwner);
    }

    function _changeOwner(address _newOwner) internal virtual onlyOwner {
        require(_newOwner != address(0), "Address must not be null");
        owner = _newOwner;
        emit OwnerChanged(_newOwner);
    }
}

