// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Transaction, TransactionHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/TransactionHelper.sol";

library Signatures {
    uint256 public constant SINGLE_LENGTH = 65;

    /// Similar to `return (_fullSignature[:65], _fullSignature[65:]);` with `bytes calldata` but for `bytes memory`
    function splitSignatures(
        bytes memory _fullSignature
    ) internal pure returns (bytes memory _signature1, bytes memory _signature2) {
        if (_fullSignature.length == SINGLE_LENGTH) {
            return (_fullSignature, _signature2);
        }

        require(_fullSignature.length == 2 * SINGLE_LENGTH, "argent/invalid-signature-length");
        _signature1 = new bytes(SINGLE_LENGTH);
        _signature2 = new bytes(SINGLE_LENGTH);

        assembly {
            // Copying the first signature. Note, that we need an offset of 0x20
            // since it is where the length of the `_fullSignature` is stored
            let r1 := mload(add(_fullSignature, 0x20))
            let s1 := mload(add(_fullSignature, 0x40))
            let v1 := and(mload(add(_fullSignature, 0x41)), 0xff)
            mstore(add(_signature1, 0x20), r1)
            mstore(add(_signature1, 0x40), s1)
            mstore8(add(_signature1, 0x60), v1)

            // Copying the second signature.
            let r2 := mload(add(_fullSignature, 0x61))
            let s2 := mload(add(_fullSignature, 0x81))
            let v2 := and(mload(add(_fullSignature, 0x82)), 0xff)
            mstore(add(_signature2, 0x20), r2)
            mstore(add(_signature2, 0x40), s2)
            mstore8(add(_signature2, 0x60), v2)
        }
    }
}
