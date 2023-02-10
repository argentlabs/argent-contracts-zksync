// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Transaction, TransactionHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/TransactionHelper.sol";

library Signatures {
    // non-reverting version of ECDSA.recover that returns address(0) if anything is invalid
    function recoverSigner(bytes32 _hash, bytes memory _signature) internal pure returns (address) {
        if (_signature.length != 65) {
            return address(0);
        }

        uint8 v;
        bytes32 r;
        bytes32 s;
        // Signature loading code
        // we jump 32 (0x20) as the first slot of bytes contains the length
        // we jump 65 (0x41) per signature
        // for v we load 32 bytes ending with v (the first 31 come from s) then apply a mask
        assembly {
            r := mload(add(_signature, 0x20))
            s := mload(add(_signature, 0x40))
            v := and(mload(add(_signature, 0x41)), 0xff)
        }
        if (v != 27 && v != 28) {
            return address(0);
        }

        // EIP-2 still allows signature malleability for ecrecover(). Remove this possibility and make the signature
        // unique. Appendix F in the Ethereum Yellow paper (https://ethereum.github.io/yellowpaper/paper.pdf), defines
        // the valid range for s in (301): 0 < s < secp256k1n ÷ 2 + 1, and for v in (302): v ∈ {27, 28}. Most
        // signatures from current libraries generate a unique signature with an s-value in the lower half order.
        //
        // If your library generates malleable signatures, such as s-values in the upper range, calculate a new s-value
        // with 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141 - s1 and flip v from 27 to 28 or
        // vice versa. If your library also generates signatures with 0/1 for v instead 27/28, add 27 to v to accept
        // these malleable signatures as well.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }

        return ecrecover(_hash, v, r, s);
    }

    // equivalent of `return (_fullSignature[:65], _fullSignature[65:130]);` with `bytes calldata` but for `bytes memory`
    function splitSignatures(
        bytes memory _fullSignature
    ) internal pure returns (bytes memory _signature1, bytes memory _signature2) {
        require(_fullSignature.length == 65 || _fullSignature.length == 130, "argent/invalid-signature-length");

        // Copying the first signature. Note, that we need an offset of 0x20
        // since it is where the length of the `_fullSignature` is stored
        _signature1 = new bytes(65);
        assembly {
            let r := mload(add(_fullSignature, 0x20))
            let s := mload(add(_fullSignature, 0x40))
            let v := and(mload(add(_fullSignature, 0x41)), 0xff)

            mstore(add(_signature1, 0x20), r)
            mstore(add(_signature1, 0x40), s)
            mstore8(add(_signature1, 0x60), v)
        }

        if (_fullSignature.length == 65) {
            return (_signature1, _signature2);
        }

        // Copying the second signature.
        _signature2 = new bytes(65);
        assembly {
            let r := mload(add(_fullSignature, 0x61))
            let s := mload(add(_fullSignature, 0x81))
            let v := and(mload(add(_fullSignature, 0x82)), 0xff)

            mstore(add(_signature2, 0x20), r)
            mstore(add(_signature2, 0x40), s)
            mstore8(add(_signature2, 0x60), v)
        }
    }
}
