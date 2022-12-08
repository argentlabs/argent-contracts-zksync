// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Transaction} from "@matterlabs/zksync-contracts/l2/system-contracts/TransactionHelper.sol";

import {SponsorPaymaster} from "./SponsorPaymaster.sol";
import {MeaningfulTransaction} from "./SignatureCheckPaymaster.sol";

contract EOASignatureCheckPaymaster is SponsorPaymaster {
    using MeaningfulTransaction for Transaction;
    using SignatureChecker for address;
    using ECDSA for bytes32;

    function isSponsoredTransaction(Transaction calldata _transaction) internal view override returns (bool) {
        bytes memory signature = abi.decode(_transaction.paymasterInput[4:], (bytes));
        bytes32 messageHash = _transaction.hashMeaningfulTransaction().toEthSignedMessageHash();
        return owner.isValidSignatureNow(messageHash, signature);
    }
}
