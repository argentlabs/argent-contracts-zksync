// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {IPaymaster, ExecutionResult} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IPaymaster.sol";
import {IPaymasterFlow} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IPaymasterFlow.sol";
import {Transaction} from "@matterlabs/zksync-contracts/l2/system-contracts/TransactionHelper.sol";
import {BOOTLOADER_FORMAL_ADDRESS} from "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";

import {ArgentAccountDetector} from "./ArgentAccountDetector.sol";

contract ArgentAccountPaymaster is IPaymaster, ArgentAccountDetector {
    modifier onlyBootloader() {
        require(msg.sender == BOOTLOADER_FORMAL_ADDRESS, "Only bootloader can call this method");
        // Continue execution if called from the bootloader.
        _;
    }

    constructor(
        bytes32[] memory _codes,
        address[] memory _implementations
    ) ArgentAccountDetector(_codes, _implementations) {}

    function validateAndPayForPaymasterTransaction(
        bytes32 /*_txHash*/,
        bytes32 /*_suggestedSignedHash*/,
        Transaction calldata _transaction
    ) external payable override onlyBootloader returns (bytes memory _context) {
        require(_transaction.paymasterInput.length >= 4, "The standard paymaster input must be at least 4 bytes long");

        bytes4 paymasterInputSelector = bytes4(_transaction.paymasterInput[0:4]);
        if (paymasterInputSelector != IPaymasterFlow.general.selector) {
            revert("Unsupported paymaster flow");
        }

        if (!_isArgentAccount(address(uint160(_transaction.from)))) {
            revert("Unsponsored account");
        }

        // Note, that while the minimal amount of ETH needed is tx.ergsPrice * tx.ergsLimit,
        // neither paymaster nor account are allowed to access this context variable.
        uint256 requiredEth = _transaction.ergsLimit * _transaction.maxFeePerErg;

        // The bootloader never returns any data, so it can safely be ignored here.
        (bool success, ) = payable(BOOTLOADER_FORMAL_ADDRESS).call{value: requiredEth}("");
        require(success, "Failed to transfer funds to the bootloader");
        return _context;
    }

    function postOp(
        bytes calldata _context,
        Transaction calldata _transaction,
        bytes32 _txHash,
        bytes32 _suggestedSignedHash,
        ExecutionResult _txResult,
        uint256 _maxRefundedErgs
    ) external payable onlyBootloader {
        // This contract does not support any refunding logic
    }

    function recoverToken(address _recipient, address _token) external onlyOwner returns (uint256 balance) {
        bool success;
        if (_token == address(0)) {
            balance = address(this).balance;
            (success, ) = _recipient.call{value: balance}("");
        } else {
            balance = IERC20(_token).balanceOf(address(this));
            success = IERC20(_token).transfer(_recipient, balance);
        }
        require(success, "failed to recover");
    }

    receive() external payable {}
}
