//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.16;

import {IERC165} from "@openzeppelin/contracts/interfaces/IERC165.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import {SystemContractsCaller, INonceHolder} from "@matterlabs/zksync-contracts/l2/system-contracts/SystemContractsCaller.sol";
import {BOOTLOADER_FORMAL_ADDRESS, DEPLOYER_SYSTEM_CONTRACT, NONCE_HOLDER_SYSTEM_CONTRACT} from "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import {Transaction, TransactionHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/TransactionHelper.sol";
import {IAccount} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IAccount.sol";

contract ArgentAccount is IAccount, IERC165, IERC1271 {
    using TransactionHelper for Transaction;
    using ERC165Checker for address;

    enum EscapeType {
        None,
        Guardian,
        Owner
    }

    struct Escape {
        uint32 activeAt; // timestamp for activation of escape mode, 0 otherwise
        uint8 escapeType; // packed EscapeType enum
    }

    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    string public constant VERSION = "0.0.1";
    address public constant NO_GUARDIAN = address(0);

    uint8 public constant NO_ESCAPE = uint8(EscapeType.None);
    uint8 public constant GUARDIAN_ESCAPE = uint8(EscapeType.Guardian);
    uint8 public constant OWNER_ESCAPE = uint8(EscapeType.Owner);

    uint32 public immutable escapeSecurityPeriod;

    address public implementation; // !!! storage slot shared with proxy
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

    modifier onlySelf() {
        require(msg.sender == address(this), "argent/only-self");
        _;
    }

    modifier requireGuardian() {
        require(guardian != address(0), "argent/guardian-required");
        _;
    }

    modifier onlyBootloader() {
        require(msg.sender == BOOTLOADER_FORMAL_ADDRESS, "argent/only-bootloader");
        // Continue execution if called from the bootloader.
        _;
    }

    receive() external payable {
        // If the bootloader called the `receive` function, it likely means
        // that something went wrong and the transaction should be aborted. The bootloader should
        // only interact through the `validateTransaction`/`executeTransaction` methods.
        assert(msg.sender != BOOTLOADER_FORMAL_ADDRESS);
    }

    constructor(uint32 _escapeSecurityPeriod) {
        require(_escapeSecurityPeriod != 0, "argent/null-escape-security-period");
        escapeSecurityPeriod = _escapeSecurityPeriod;
    }

    function initialize(address _owner, address _guardian) external {
        require(_owner != address(0), "argent/null-owner");
        require(owner == address(0), "argent/already-init");
        owner = _owner;
        guardian = _guardian;
        emit AccountCreated(address(this), _owner, _guardian);
    }

    function upgrade(address _newImplementation) external onlySelf {
        require(_newImplementation.supportsInterface(type(IAccount).interfaceId), "argent/invalid-implementation");
        implementation = _newImplementation;
        emit AccountUpgraded(_newImplementation);
    }

    function multicall(Call[] memory _calls) external onlySelf {
        for (uint256 i = 0; i < _calls.length; i++) {
            Call memory call = _calls[i];
            require(call.to != address(this), "argent/no-multicall-to-self");
            _execute(call.to, call.value, call.data);
        }
    }

    // Recovery

    function changeOwner(address _newOwner) public onlySelf {
        require(_newOwner != address(0), "argent/null-owner");
        owner = _newOwner;
        emit OwnerChanged(_newOwner);
    }

    function changeGuardian(address _newGuardian) public onlySelf {
        require(_newGuardian != address(0), "argent/null-guardian");
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
            require(escape.escapeType == OWNER_ESCAPE, "argent/cannot-override-owner-escape");
        }

        uint32 activeAt = uint32(block.timestamp) + escapeSecurityPeriod;
        escape = Escape(activeAt, OWNER_ESCAPE);
        emit EscapeOwnerTriggerred(activeAt);
    }

    function triggerEscapeGuardian() public onlySelf requireGuardian {
        uint32 activeAt = uint32(block.timestamp) + escapeSecurityPeriod;
        escape = Escape(activeAt, GUARDIAN_ESCAPE);
        emit EscapeGuardianTriggerred(activeAt);
    }

    function cancelEscape() public onlySelf {
        require(escape.activeAt != 0 && escape.escapeType != NO_ESCAPE, "argent/not-escaping");

        delete escape;
        emit EscapeCancelled();
    }

    function escapeOwner(address _newOwner) public onlySelf requireGuardian {
        require(_newOwner != address(0), "argent/null-owner");
        require(escape.activeAt != 0, "argent/not-escaping");
        require(escape.activeAt <= block.timestamp, "argent/inactive-escape");
        require(escape.escapeType == OWNER_ESCAPE, "argent/invalid-escape-type");

        delete escape;
        owner = _newOwner;
        emit OwnerEscaped(_newOwner);
    }

    function escapeGuardian(address _newGuardian) public onlySelf requireGuardian {
        require(_newGuardian != address(0), "argent/null-guardian");
        require(escape.activeAt != 0, "argent/not-escaping");
        require(escape.activeAt <= block.timestamp, "argent/inactive-escape");
        require(escape.escapeType == GUARDIAN_ESCAPE, "argent/invalid-escape-type");

        delete escape;
        guardian = _newGuardian;
        emit GuardianEscaped(_newGuardian);
    }

    // IAccount implementation

    function validateTransaction(
        bytes32, // _txHash
        bytes32 _suggestedSignedHash,
        Transaction calldata _transaction
    ) external payable override onlyBootloader {
        _validateTransaction(_suggestedSignedHash, _transaction);
    }

    function _validateTransaction(bytes32 _suggestedSignedHash, Transaction calldata _transaction) internal {
        // no need to check if account is initialized because it's done during proxy deployment

        bytes memory calldata_ = abi.encodeCall(INonceHolder.incrementMinNonceIfEquals, (_transaction.reserved[0]));
        SystemContractsCaller.systemCall(uint32(gasleft()), address(NONCE_HOLDER_SYSTEM_CONTRACT), 0, calldata_);

        bytes32 txHash;
        if (_suggestedSignedHash == bytes32(0)) {
            txHash = _transaction.encodeHash();
        } else {
            txHash = _suggestedSignedHash;
        }

        bytes4 selector = bytes4(_transaction.data);
        bool toSelf = _transaction.to == uint256(uint160(address(this)));
        if (toSelf && (selector == this.escapeOwner.selector || selector == this.triggerEscapeOwner.selector)) {
            validateGuardianSignature(txHash, _transaction.signature);
        } else if (
            toSelf && (selector == this.escapeGuardian.selector || selector == this.triggerEscapeGuardian.selector)
        ) {
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
        if (guardian == NO_GUARDIAN) {
            return;
        }
        require(_signature.length == 65, "argent/invalid-guardian-signature-length");
        address recovered = ECDSA.recover(_hash, _signature);
        if (recovered == guardian) {
            return;
        }
        if (recovered == guardianBackup && guardianBackup != NO_GUARDIAN) {
            return;
        }
        revert("argent/invalid-guardian-signature");
    }

    function executeTransaction(
        bytes32, // _txHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable override onlyBootloader {
        _execute(address(uint160(_transaction.to)), _transaction.reserved[1], _transaction.data);
    }

    function executeTransactionFromOutside(Transaction calldata _transaction) external payable override onlyBootloader {
        _validateTransaction(bytes32(0), _transaction); // The account recalculates the hash on its own
        _execute(address(uint160(_transaction.to)), _transaction.reserved[1], _transaction.data);
    }

    function _execute(address to, uint256 value, bytes memory data) internal {
        if (to == address(DEPLOYER_SYSTEM_CONTRACT)) {
            // We allow calling ContractDeployer with any calldata
            SystemContractsCaller.systemCall(uint32(gasleft()), to, uint128(value), data);
        } else {
            // using assembly saves us a returndatacopy of the entire return data
            bool success;
            assembly {
                success := call(gas(), to, value, add(data, 0x20), mload(data), 0, 0)
            }
            require(success);
        }
    }

    function payForTransaction(
        bytes32, // _txHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable override onlyBootloader {
        bool success = _transaction.payToTheBootloader();
        require(success, "argent/failed-fee-payment");
    }

    // Here, the user should prepare for the transaction to be paid for by a paymaster
    // Here, the account should set the allowance for the smart contracts
    function prePaymaster(
        bytes32, // _txHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable override onlyBootloader {
        _transaction.processPaymasterInput();
    }

    // IERC165 implementation

    function supportsInterface(bytes4 _interfaceId) external pure override returns (bool) {
        // NOTE: it'll be more efficient to use a mapping based implementation if there are more than 3 interfaces
        return
            _interfaceId == type(IERC165).interfaceId ||
            _interfaceId == type(IERC1271).interfaceId ||
            _interfaceId == type(IAccount).interfaceId;
    }

    // IERC1271 implementation

    function isValidSignature(bytes32 _hash, bytes calldata _signature) public view override returns (bytes4) {
        validateSignatures(_hash, _signature);
        return IERC1271.isValidSignature.selector;
    }
}
