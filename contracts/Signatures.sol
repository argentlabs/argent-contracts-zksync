// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

library Signatures {
    uint256 public constant SINGLE_LENGTH = 65;
    uint256 public constant DOUBLE_LENGTH = 2 * SINGLE_LENGTH;

    /// Non-reverting version of ECDSA.recover that returns address(0) if anything is invalid
    function recoverSigner(bytes32 _hash, bytes memory _signature) internal pure returns (address) {
        if (_signature.length != SINGLE_LENGTH) {
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

    /// Similar to `return (_fullSignature[:65], _fullSignature[65:]);` with `bytes calldata` but for `bytes memory`
    function splitSignatures(
        bytes memory _fullSignature
    ) internal pure returns (bytes memory _signature1, bytes memory _signature2) {
        if (_fullSignature.length == SINGLE_LENGTH) {
            return (_fullSignature, _signature2);
        }

        require(_fullSignature.length == DOUBLE_LENGTH, "argent/invalid-signature-length");
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
