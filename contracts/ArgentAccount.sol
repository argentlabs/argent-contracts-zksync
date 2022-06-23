//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import './system-contracts/Constants.sol';
import './system-contracts/TransactionHelper.sol';

import './system-contracts/interfaces/IAccountAbstraction.sol';

contract ArgentAccount is IAccountAbstraction {
	using TransactionHelper for Transaction;

    address public signer;

    constructor(address _signer) {
        signer = _signer;
    }

	/**
	 * @dev Simulate behaivour of the EOA if caller is not the bootloader.
	 * Essentially, for all non-bootloader caller halt the execution with empty return data.
	 * If all functions will use this modifier AND the contract will implement an empty payable fallback()
	 * then the contract will be indistinguishable from the EOA when called.
	 */
	modifier ignoreNonBootloader() {
		if (msg.sender != BOOTLOADER_FORMAL_ADDRESS) {
			// If function was called outside of the bootloader, behave like an EOA.
			assembly {
				return(0, 0)
			}
		}
		// Continure execution if called from the bootloader.
		_;
	}

	function validateTransaction(Transaction calldata _transaction) external payable override ignoreNonBootloader {
		_validateTransaction(_transaction);
	}

	function _validateTransaction(Transaction calldata _transaction) internal {
		NONCE_HOLDER_SYSTEM_CONTRACT.incrementNonceIfEquals(_transaction.reserved[0]);
		bytes32 txHash = _transaction.encodeHash();

		require(_recoverSignatureAddress(txHash, _transaction.signature) == signer);
	}

	function executeTransaction(Transaction calldata _transaction) external payable override ignoreNonBootloader {
		_execute(_transaction);
	}

	function executeTransactionFromOutside(Transaction calldata _transaction) external payable override ignoreNonBootloader {
		_validateTransaction(_transaction);
		_execute(_transaction);
	}

	function _execute(Transaction calldata _transaction) internal {
		uint256 to = _transaction.to;
		uint256 value = _transaction.reserved[1];
		bytes memory data = _transaction.data;

		bool success;
		assembly {
			success := call(gas(), to, value, add(data, 0x20), mload(data), 0, 0)
		}
		require(success);
	}

	fallback() external payable {
		// fallback of default AA shouldn't be called by bootloader under no circumstances 
		assert(msg.sender != BOOTLOADER_FORMAL_ADDRESS);		
		
		// If the contract is called directly, behave like an EOA
	}

	function _recoverSignatureAddress(bytes32 _hash, bytes memory _signature) internal view returns (address _recoveredAddress) {
		require(_signature.length == 65, 'Signature length is incorrect');
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
		require(v == 27 || v == 28);

		_recoveredAddress = ecrecover(_hash, v, r, s);
		require(_recoveredAddress != address(0));
	}

}
