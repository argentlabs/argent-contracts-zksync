// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

contract TestDapp {
    mapping(address user => uint256 number) public userNumbers;

    function setNumber(uint256 _number) external {
        userNumbers[msg.sender] = _number;
    }

    function increaseNumber(uint256 _increment) external returns (uint256 _newNumber) {
        _newNumber = userNumbers[msg.sender] + _increment;
        userNumbers[msg.sender] = _newNumber;
    }

    function doRevert() external pure {
        revert("foobarbaz");
    }
}
