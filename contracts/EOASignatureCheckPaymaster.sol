// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Transaction, TransactionHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/TransactionHelper.sol";

import {SponsorPaymaster} from "./SponsorPaymaster.sol";
import {MeaningfulTransaction} from "./SignatureCheckPaymaster.sol";

contract EOASignatureCheckPaymaster is SponsorPaymaster {
    using TransactionHelper for Transaction;
    using MeaningfulTransaction for Transaction;
    using ERC165Checker for address;
    using ECDSA for bytes32;

    function isSponsoredTransaction(Transaction calldata _transaction) internal view override returns (bool) {
        bytes32 messageHash = _transaction.hashMeaningfulTransaction().toEthSignedMessageHash();
        bytes memory signature = abi.decode(_transaction.paymasterInput[4:], (bytes));
        if (owner.supportsInterface(type(IERC1271).interfaceId)) {
            bytes4 result = IERC1271(owner).isValidSignature(messageHash, signature);
            return result == IERC1271.isValidSignature.selector;
        }
        address recovered = messageHash.recover(signature);
        return recovered == owner;
    }
}
