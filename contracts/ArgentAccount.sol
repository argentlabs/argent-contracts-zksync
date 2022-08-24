//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.12;

import {BOOTLOADER_FORMAL_ADDRESS, NONCE_HOLDER_SYSTEM_CONTRACT} from "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import {Transaction, TransactionHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/TransactionHelper.sol";
import {IAccountAbstraction} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IAccountAbstraction.sol";

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract ArgentAccount is IAccountAbstraction, IERC1271 {
    using TransactionHelper for Transaction;

    enum EscapeType {
        None,
        Guardian,
        Owner
    }

    struct Escape {
        uint32 activeAt; // timestamp for activation of escape mode, 0 otherwise
        uint8 escapeType; // packed EscapeType enum
    }

    string public constant version = "0.0.1";
    address public constant noGuardian = address(0);

    uint8 public constant noEscape = uint8(EscapeType.None);
    uint8 public constant guardianEscape = uint8(EscapeType.Guardian);
    uint8 public constant ownerEscape = uint8(EscapeType.Owner);

    // FIXME: using short period for testing on goerli, switch back to 1 week when local testing is available
    // uint32 public constant escapeSecurityPeriod = 1 weeks;
    uint32 public constant escapeSecurityPeriod = 10 seconds;

    bytes4 public constant eip1271SuccessReturnValue = bytes4(keccak256("isValidSignature(bytes32,bytes)"));

    address public owner;
    address public guardian;
    address public guardianBackup;
    Escape public escape;

    event AccountCreated(address account, address owner, address guardian);
    event AccountUpgraded(address newImplementation);
    event TransactionExecuted(bytes32 hashed, bytes response);

    event OwnerChanged(address newOwner);
    event GuardianChanged(address newGuardian);
    event GuardianBackupChanged(address newGuardianBackup);

    event EscapeOwnerTriggerred(uint32 activeAt);
    event EscapeGuardianTriggerred(uint32 activeAt);
    event OwnerEscaped(address newOwner);
    event GuardianEscaped(address newGuardian);
    event EscapeCancelled();

    function initialize(address _owner, address _guardian) external {
        require(_owner != address(0), "argent/invalid-owner");
        require(owner == address(0), "argent/already-init");
        owner = _owner;
        guardian = _guardian;
        emit AccountCreated(address(this), owner, guardian);
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

    function changeOwner(address _newOwner) public onlySelf {
        require(_newOwner != address(0), "argent/null-owner");
        owner = _newOwner;
        emit OwnerChanged(_newOwner);
    }

    function changeGuardian(address _newGuardian) public onlySelf {
        // TODO: next line to be reviewed by Julien
        require(_newGuardian != address(0) || guardianBackup == address(0), "argent/null-guardian");
        guardian = _newGuardian;
        emit GuardianChanged(_newGuardian);
    }

    function changeGuardianBackup(address _newGuardianBackup) public onlySelf requireGuardian {
        guardianBackup = _newGuardianBackup;
        emit GuardianBackupChanged(_newGuardianBackup);
    }

    function triggerEscapeOwner() public onlySelf requireGuardian {
        // no escape if there is an guardian escape triggered by the owner in progress
        if (escape.activeAt != 0) {
            require(escape.escapeType == ownerEscape, "argent/cannot-override-owner-escape");
        }

        uint32 activeAt = uint32(block.timestamp) + escapeSecurityPeriod;
        escape = Escape(activeAt, ownerEscape);
        emit EscapeOwnerTriggerred(activeAt);
    }

    function triggerEscapeGuardian() public onlySelf requireGuardian {
        uint32 activeAt = uint32(block.timestamp) + escapeSecurityPeriod;
        escape = Escape(activeAt, guardianEscape);
        emit EscapeGuardianTriggerred(activeAt);
    }

    function cancelEscape() public onlySelf {
        require(escape.activeAt != 0 && escape.escapeType != noEscape, "argent/not-escaping");

        delete escape;
        emit EscapeCancelled();
    }

    function escapeOwner(address _newOwner) public onlySelf requireGuardian {
        require(_newOwner != address(0), "argent/null-owner");
        require(escape.activeAt != 0, "argent/not-escaping");
        require(escape.activeAt <= block.timestamp, "argent/inactive-escape");
        require(escape.escapeType == ownerEscape, "argent/invalid-escape-type");

        delete escape;
        owner = _newOwner;
        emit OwnerEscaped(_newOwner);
    }

    function escapeGuardian(address _newGuardian) public onlySelf requireGuardian {
        require(_newGuardian != address(0), "argent/null-guardian");
        require(escape.activeAt != 0, "argent/not-escaping");
        require(escape.activeAt <= block.timestamp, "argent/inactive-escape");
        require(escape.escapeType == guardianEscape, "argent/invalid-escape-type");

        delete escape;
        guardian = _newGuardian;
        emit GuardianEscaped(_newGuardian);
    }

    // Account methods

    function validateTransaction(Transaction calldata _transaction) external payable override onlyBootloader {
        _validateTransaction(_transaction);
    }

    function _validateTransaction(Transaction calldata _transaction) internal {
        NONCE_HOLDER_SYSTEM_CONTRACT.incrementNonceIfEquals(_transaction.reserved[0]);
        bytes32 txHash = _transaction.encodeHash();
        bytes4 selector = bytes4(_transaction.data);
        if (selector == this.escapeOwner.selector || selector == this.triggerEscapeOwner.selector) {
            validateGuardianSignature(txHash, _transaction.signature);
        } else if (selector == this.escapeGuardian.selector || selector == this.triggerEscapeGuardian.selector) {
            validateOwnerSignature(txHash, _transaction.signature);
        } else {
            validateSignatures(txHash, _transaction.signature);
        }
    }

    function validateSignatures(bytes32 _hash, bytes calldata _signature) internal view {
        validateOwnerSignature(_hash, _signature[:65]);
        validateGuardianSignature(_hash, _signature[65:]);
    }

    function validateOwnerSignature(bytes32 _hash, bytes calldata _signature) internal view {
        require(_signature.length == 65, "argent/invalid-owner-signature-length");
        address recovered = ECDSA.recover(_hash, _signature);
        require(recovered == owner, "argent/invalid-owner-signature");
    }

    function validateGuardianSignature(bytes32 _hash, bytes calldata _signature) internal view {
        if (guardian == noGuardian) {
            return;
        }
        require(_signature.length == 65, "argent/invalid-guardian-signature-length");
        address recovered = ECDSA.recover(_hash, _signature);
        if (recovered == guardian) {
            return;
        }
        if (recovered == guardianBackup && guardianBackup != noGuardian) {
            return;
        }
        revert("argent/invalid-guardian-signature");
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
        validateSignatures(_hash, _signature);
        return eip1271SuccessReturnValue;
    }

    receive() external payable {
        // If the bootloader called the `receive` function, it likely means
        // that something went wrong and the transaction should be aborted. The bootloader should
        // only interact through the `validateTransaction`/`executeTransaction` methods.
        assert(msg.sender != BOOTLOADER_FORMAL_ADDRESS);
    }
}
