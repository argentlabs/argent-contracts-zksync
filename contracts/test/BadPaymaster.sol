// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import {IPaymaster, ExecutionResult, PAYMASTER_VALIDATION_SUCCESS_MAGIC} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IPaymaster.sol";
import {IPaymasterFlow} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IPaymasterFlow.sol";
import {Transaction} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/TransactionHelper.sol";
import {BOOTLOADER_FORMAL_ADDRESS} from "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract BadPaymaster is IPaymaster {
    uint256 constant PRICE_FOR_PAYING_FEES = 100;

    modifier onlyBootloader() {
        require(msg.sender == BOOTLOADER_FORMAL_ADDRESS, "Only bootloader can call this method");
        // Continue execution if called from the bootloader.
        _;
    }

    function validateAndPayForPaymasterTransaction(
        bytes32,
        bytes32,
        Transaction calldata _transaction
    ) external payable returns (bytes4 _magic, bytes memory _context) {
        require(_transaction.paymasterInput.length >= 4, "The standard paymaster input must be at least 4 bytes long");

        bytes4 paymasterInputSelector = bytes4(_transaction.paymasterInput[0:4]);
        if (paymasterInputSelector != IPaymasterFlow.approvalBased.selector) {
            revert("Unsupported paymaster flow");
        }

        (address token, uint256 amount, bytes memory data) = abi.decode(
            _transaction.paymasterInput[4:],
            (address, uint256, bytes)
        );

        address userAddress = address(uint160(_transaction.from));
        address thisAddress = address(this);

        uint256 providedAllowance = IERC20(token).allowance(userAddress, thisAddress);
        require(providedAllowance >= PRICE_FOR_PAYING_FEES, "Min allowance too low");

        IERC20(token).transferFrom(userAddress, thisAddress, providedAllowance);

        uint256 requiredEth = _transaction.gasLimit * _transaction.maxFeePerGas;
        (bool success, ) = payable(BOOTLOADER_FORMAL_ADDRESS).call{value: requiredEth}("");
        require(success, "Failed to transfer funds to the bootloader");
        _magic = PAYMASTER_VALIDATION_SUCCESS_MAGIC;
    }

    function postTransaction(
        bytes calldata _context,
        Transaction calldata _transaction,
        bytes32,
        bytes32,
        ExecutionResult _txResult,
        uint256 _maxRefundedGas
    ) external payable override {}

    receive() external payable {}
}
