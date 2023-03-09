//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.18;

contract TestDapp {
    mapping(address user => uint256 number) public userNumbers;

    function setNumber(uint256 _number) external {
        userNumbers[msg.sender] = _number;
    }

    function increaseNumber(uint256 _increment) external {
        userNumbers[msg.sender] += _increment;
    }

    function doRevert() external pure {
        revert("foobarbaz");
    }
}
