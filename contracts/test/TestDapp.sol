// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

    function depositTokens(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }

    function depositPair(address token1, uint256 amount1, address token2, uint256 amount2) external {
        IERC20(token1).transferFrom(msg.sender, address(this), amount1);
        IERC20(token2).transferFrom(msg.sender, address(this), amount2);
    }
}
