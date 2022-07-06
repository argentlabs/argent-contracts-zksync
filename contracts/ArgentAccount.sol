//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import "@matterlabs/zksync-contracts/l2/system-contracts/TransactionHelper.sol";
import "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IAccountAbstraction.sol";

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract ArgentAccount is IAccountAbstraction, IERC1271 {
    using TransactionHelper for Transaction;

    enum EscapeType {
        None,
        Guardian,
        Signer
    }

    struct Escape {
        uint96 activeAt; // timestamp for activation of escape mode, 0 otherwise
        uint8 escapeType; // packed EscapeType enum
    }

    uint8 public constant noEscape = uint8(EscapeType.None);
    uint8 public constant guardianEscape = uint8(EscapeType.Guardian);
    uint8 public constant signerEscape = uint8(EscapeType.Signer);
    uint256 public constant escapeSecurityPeriod = 1 weeks;
    bytes4 constant eip1271SuccessReturnValue = 0x1626ba7e;

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

    modifier onlyBootloader() {
        require(msg.sender == BOOTLOADER_FORMAL_ADDRESS, "Only bootloader can call this method");
        // Continue execution if called from the bootloader.
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

    // Account methods

    function validateTransaction(Transaction calldata _transaction) external payable override onlyBootloader {
        _validateTransaction(_transaction);
    }

    function _validateTransaction(Transaction calldata _transaction) internal {
        require(_transaction.signature.length == 130, "argent/invalid-signature-length");

        NONCE_HOLDER_SYSTEM_CONTRACT.incrementNonceIfEquals(_transaction.reserved[0]);
        bytes32 txHash = _transaction.encodeHash();
        bytes4 selector = bytes4(_transaction.data);
        if (selector == this.escapeSigner.selector || selector == this.triggerEscapeSigner.selector) {
            validateGuardianSignature(txHash, _transaction.signature);
        } else if (selector == this.escapeGuardian.selector || selector == this.triggerEscapeGuardian.selector) {
            validateSignerSignature(txHash, _transaction.signature);
        } else {
            validateSignerSignature(txHash, _transaction.signature);
            validateGuardianSignature(txHash, _transaction.signature);
        }
    }

    function validateSignerSignature(bytes32 _hash, bytes calldata _signature) internal view {
        address recovered = ECDSA.recover(_hash, _signature[:65]);
        require(recovered == signer, "argent/invalid-signer-signature");
    }

    function validateGuardianSignature(bytes32 _hash, bytes calldata _signature) internal view {
        address recovered = ECDSA.recover(_hash, _signature[65:]);
        require(recovered == guardian, "argent/invalid-guardian-signature");
    }

    function executeTransaction(Transaction calldata _transaction) external payable override onlyBootloader {
        _execute(_transaction);
    }

    function executeTransactionFromOutside(Transaction calldata _transaction) external payable override onlyBootloader {
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

    function isValidSignature(bytes32 _hash, bytes calldata _signature) public view override returns (bytes4) {
        require(_signature.length == 130, "argent/invalid-signature-length");

        validateSignerSignature(_hash, _signature);
        validateGuardianSignature(_hash, _signature);

        return eip1271SuccessReturnValue;
    }

    receive() external payable {
        // If the bootloader called the `receive` function, it likely means
        // that something went wrong and the transaction should be aborted. The bootloader should
        // only interact through the `validateTransaction`/`executeTransaction` methods.
        assert(msg.sender != BOOTLOADER_FORMAL_ADDRESS);
    }
}
