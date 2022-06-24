//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import "@matterlabs/zksync-contracts/l2/system-contracts/TransactionHelper.sol";
import "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IAccountAbstraction.sol";

contract ArgentAccount is IAccountAbstraction {
    using TransactionHelper for Transaction;

    enum EscapeType { None, Guardian, Signer }

    struct Escape {
        uint96 activeAt; // timestamp for activation of escape mode, 0 otherwise
        uint8 escapeType; // packed EscapeType enum
    }

    uint8 public constant noEscape = uint8(EscapeType.None);
    uint8 public constant guardianEscape = uint8(EscapeType.Guardian);
    uint8 public constant signerEscape = uint8(EscapeType.Signer);
    uint256 public constant escapeSecurityPeriod = 1 weeks;

    address public signer;
    address public guardian;
    address public guardianBackup;
    Escape public escape;

    event AccountCreated(address account, address signer, address guardian);
    event AccountUpgraded(address newImplementation);
    event TransactionExecuted(bytes32 hashed, bytes response);

    event SignerChanged(address newSigner);
    event GuardianChanged(address newGuardian);
    event GuardianBackupChanged(address newGuardianBackup);

    event EscapeSignerTriggerred(uint96 activeAt);
    event EscapeGuardianTriggerred(uint96 activeAt);
    event SignerEscaped(address newSigner);
    event GuardianEscaped(address newGuardian);
    event EscapeCancelled();

    function initialize(address _signer, address _guardian) external {
        require(signer == address(0), "argent/already-init");
        require(_signer != address(0), "argent/invalid-signer");
        signer = _signer;
        guardian = _guardian;
        emit AccountCreated(address(this), signer, guardian);
    }

    modifier onlySelf() {
        require(msg.sender == address(this), "argent/only-self");
        _;
    }

    modifier requireGuardian() {
        require(guardian != address(0), "argent/guardian-required");
        _;
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
    
    // Recovery

    function changeSigner(address _newSigner) public onlySelf {
        require(_newSigner != address(0), "argent/null-signer");
        signer = _newSigner;
        emit SignerChanged(_newSigner);
    }

    function changeGuardian(address _newGuardian) public onlySelf {
        require(!(guardianBackup != address(0) && _newGuardian == address(0)), "argent/null-guardian");
        guardian = _newGuardian;
        emit GuardianChanged(_newGuardian);
    }

    function changeGuardianBackup(address _newGuardianBackup) public onlySelf requireGuardian {
        guardianBackup = _newGuardianBackup;
        emit GuardianBackupChanged(_newGuardianBackup);
    }

    function triggerEscapeSigner() public onlySelf requireGuardian {
        // no escape if there is an guardian escape triggered by the signer in progress
        if (escape.activeAt != 0) {
            require(escape.escapeType == signerEscape, "argent/cannot-override-signer-escape");
        }

        uint96 activeAt = uint96(block.timestamp + escapeSecurityPeriod);
        escape = Escape(activeAt, signerEscape);
        emit EscapeSignerTriggerred(activeAt);
    }

    function triggerEscapeGuardian() public onlySelf requireGuardian {
        uint96 activeAt = uint96(block.timestamp + escapeSecurityPeriod);
        escape = Escape(activeAt, guardianEscape);
        emit EscapeGuardianTriggerred(activeAt);
    }

    function cancelEscape() public onlySelf {
        require(escape.activeAt != 0 && escape.escapeType != noEscape, "argent/not-escaping");

        delete escape;
        emit EscapeCancelled();
    }

    function escapeSigner(address _newSigner) public onlySelf requireGuardian {
        require(escape.activeAt != 0, "argent/not-escaping");
        require(escape.activeAt <= block.timestamp, "argent/inactive-escape");
        require(escape.escapeType == signerEscape, "argent/invalid-escape-type");
        delete escape;

        require(_newSigner != address(0), "argent/null-signer");
        signer = _newSigner;

        emit SignerEscaped(_newSigner);
    }

    function escapeGuardian(address _newGuardian) public onlySelf {
        require(escape.activeAt != 0, "argent/not-escaping");
        require(escape.activeAt <= block.timestamp, "argent/inactive-escape");
        require(escape.escapeType == guardianEscape, "argent/invalid-escape-type");
        delete escape;

        require(_newGuardian != address(0), "argent/null-guardian");
        guardian = _newGuardian;

        emit GuardianEscaped(_newGuardian);
    }

    function validateTransaction(Transaction calldata _transaction) external payable override ignoreNonBootloader {
        _validateTransaction(_transaction);
    }

    function _validateTransaction(Transaction calldata _transaction) internal {
        NONCE_HOLDER_SYSTEM_CONTRACT.incrementNonceIfEquals(_transaction.reserved[0]);
        bytes32 txHash = _transaction.encodeHash();
        _validateSignature(txHash, _transaction.signature, signer);
    }

    function executeTransaction(Transaction calldata _transaction) external payable override ignoreNonBootloader {
        _execute(_transaction);
    }

    function executeTransactionFromOutside(Transaction calldata _transaction)
        external
        payable
        override
        ignoreNonBootloader
    {
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

    function _validateSignature(bytes32 _hash, bytes memory _signature, address _address)
        internal
        view
    {
        require(_signature.length == 65, "argent/signature-length-incorrect");
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
        require(ecrecover(_hash, v, r, s) == _address);
    }

    fallback() external payable {
        // fallback of default AA shouldn't be called by bootloader under no circumstances
        assert(msg.sender != BOOTLOADER_FORMAL_ADDRESS);

        // If the contract is called directly, behave like an EOA
    }
}
