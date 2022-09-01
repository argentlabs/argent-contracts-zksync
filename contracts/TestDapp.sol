//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.16;

contract TestDapp {
    mapping(address => uint256) public userNumbers;

    function setNumber(uint256 _number) external {
        userNumbers[msg.sender] = _number;
    }
}
