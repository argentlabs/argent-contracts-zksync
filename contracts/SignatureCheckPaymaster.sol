// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Transaction, TransactionHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/TransactionHelper.sol";

import {SponsorPaymaster} from "./SponsorPaymaster.sol";

contract SignatureCheckPaymaster is SponsorPaymaster {
    using TransactionHelper for Transaction;

    function isSponsoredTransaction(
        Transaction calldata _transaction,
        bytes calldata _signature
    ) internal view override returns (bool) {
        bytes32 transactionHash = _transaction.encodeHash();
        bytes4 result = IERC1271(owner).isValidSignature(transactionHash, _signature);
        return result == IERC1271.isValidSignature.selector;
    }
}
