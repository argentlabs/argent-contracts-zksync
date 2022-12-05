// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Transaction, TransactionHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/TransactionHelper.sol";

import {SponsorPaymaster} from "./SponsorPaymaster.sol";

library MeaningfulTransaction {
    /**
     * Computes a digest of the transaction excluding any signature or paymaster input.
     */
    function hashMeaningfulTransaction(Transaction calldata _transaction) internal pure returns (bytes32) {
        bytes memory encoded = abi.encode(
            _transaction.txType,
            _transaction.from,
            _transaction.to,
            _transaction.ergsLimit,
            _transaction.ergsPerPubdataByteLimit,
            _transaction.maxFeePerErg,
            _transaction.maxPriorityFeePerErg,
            _transaction.reserved[0], // nonce
            _transaction.reserved[1], // value
            keccak256(_transaction.data),
            keccak256(abi.encodePacked(_transaction.factoryDeps))
        );
        return keccak256(encoded);
    }
}

contract SignatureCheckPaymaster is SponsorPaymaster, EIP712 {
    using TransactionHelper for Transaction;
    using MeaningfulTransaction for Transaction;
    using ERC165Checker for address;
    using ECDSA for bytes32;

    constructor() EIP712("SignatureCheckPaymaster", "1") {
        requireERC1271Support(owner);
    }

    function isSponsoredTransaction(Transaction calldata _transaction) internal view override returns (bool) {
        bytes memory signature = abi.decode(_transaction.paymasterInput[4:], (bytes));
        bytes32 messageHash = _hashTypedDataV4(_transaction.hashMeaningfulTransaction());
        bytes4 result = IERC1271(owner).isValidSignature(messageHash, signature);
        return result == IERC1271.isValidSignature.selector;
    }

    function _changeOwner(address _newOwner) internal override onlyOwner {
        requireERC1271Support(_newOwner);
        super._changeOwner(_newOwner);
    }

    function requireERC1271Support(address _owner) internal view {
        require(_owner.supportsInterface(type(IERC1271).interfaceId), "non-ERC1271 owner");
    }
}
