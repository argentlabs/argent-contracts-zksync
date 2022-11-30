// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Transaction, TransactionHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/TransactionHelper.sol";

import {SponsorPaymaster} from "./SponsorPaymaster.sol";

contract SignatureCheckPaymaster is SponsorPaymaster {
    using TransactionHelper for Transaction;
    using ERC165Checker for address;

    event Foo(bytes32 _transactionHash, bytes32 _suggestedSignedHash);

    constructor() {
        // require(owner.supportsInterface(type(IERC1271).interfaceId), "non-IERC1271 owner");
    }

    function isSponsoredTransaction(
        bytes32 _transactionHash,
        bytes32 _suggestedSignedHash,
        Transaction calldata _transaction
    ) internal override returns (bool) {
        emit Foo(_transactionHash, _suggestedSignedHash);
        bytes calldata signature = _transaction.paymasterInput[4:];
        bytes32 transactionHash = _transaction.encodeHash();
        if (owner.supportsInterface(type(IERC1271).interfaceId)) {
            bytes4 result = IERC1271(owner).isValidSignature(transactionHash, signature);
            return result == IERC1271.isValidSignature.selector;
        }
        return true;
        address recovered = ECDSA.recover(transactionHash, signature[:65]);
        return recovered == owner;
    }
}
