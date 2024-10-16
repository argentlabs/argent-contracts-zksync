// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import {IERC165} from "@openzeppelin/contracts/interfaces/IERC165.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";

import {BOOTLOADER_FORMAL_ADDRESS, DEPLOYER_SYSTEM_CONTRACT, NONCE_HOLDER_SYSTEM_CONTRACT} from "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import {IAccount, ACCOUNT_VALIDATION_SUCCESS_MAGIC} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IAccount.sol";
import {INonceHolder} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/INonceHolder.sol";
import {SystemContractsCaller} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/SystemContractsCaller.sol";
import {SystemContractHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/SystemContractHelper.sol";
import {Transaction, TransactionHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/TransactionHelper.sol";
import {Utils} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/Utils.sol";

import {Signatures} from "../Signatures.sol";
import {IUpgradeCallback} from "../IUpgradeCallback.sol";

contract UpgradedArgentAccount is IAccount, IUpgradeCallback, IERC165, IERC1271 {
    using TransactionHelper for Transaction;
    using ERC165Checker for address;

    struct Version {
        uint8 major;
        uint8 minor;
        uint8 patch;
    }

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

    bytes32 public constant VERSION = bytes32(abi.encodePacked("next"));

    uint8 public constant NO_ESCAPE = uint8(EscapeType.None);
    uint8 public constant GUARDIAN_ESCAPE = uint8(EscapeType.Guardian);
    uint8 public constant OWNER_ESCAPE = uint8(EscapeType.Owner);

    uint32 public immutable escapeSecurityPeriod;

    address public implementation; // !!! storage slot shared with proxy
    address public owner;
    address public guardian;
    address public guardianBackup;
    Escape public escape;
    uint256 public newStorage; // !!! new storage slot

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

    // inlined modifiers for consistency of requirements, easier auditing and some gas savings

    function requireOnlySelf() internal view {
        require(msg.sender == address(this), "argent/only-self");
    }

    function requireGuardian() internal view {
        require(guardian != address(0), "argent/guardian-required");
    }

    function requireOnlyBootloader() internal view {
        require(msg.sender == BOOTLOADER_FORMAL_ADDRESS, "argent/only-bootloader");
    }

    constructor(uint32 _escapeSecurityPeriod) {
        require(_escapeSecurityPeriod != 0, "argent/null-escape-security-period");
        escapeSecurityPeriod = _escapeSecurityPeriod;
    }

    function version() public pure returns (Version memory) {
        return Version(99, 9, 9);
    }

    function initialize(address _owner, address _guardian) external {
        require(_owner != address(0), "argent/null-owner");
        require(owner == address(0), "argent/already-initialized");
        owner = _owner;
        guardian = _guardian;
        emit AccountCreated(address(this), _owner, _guardian);
    }

    function upgrade(address _newImplementation, bytes calldata _data) external {
        requireOnlySelf();
        bool isSupported = _newImplementation.supportsInterface(type(IAccount).interfaceId);
        require(isSupported, "argent/invalid-implementation");
        address oldImplementation = implementation;
        implementation = _newImplementation;
        emit AccountUpgraded(_newImplementation);
        // using delegatecall to run the `executeAfterUpgrade` function of the new implementation
        (bool success, ) = _newImplementation.delegatecall(
            abi.encodeCall(IUpgradeCallback.executeAfterUpgrade, (oldImplementation, _data))
        );
        require(success, "argent/upgrade-callback-failed");
    }

    /// @inheritdoc IUpgradeCallback
    // only callable by `upgrade`, enforced in `validateTransaction` and `multicall`
    function executeAfterUpgrade(address /*_oldImplementation*/, bytes calldata _data) external {
        requireOnlySelf();
        if (_data.length == 32) {
            newStorage = abi.decode(_data, (uint256));
        } else {
            require(_data.length == 0, "argent/bad-data-size");
        }
    }

    function multicall(Call[] memory _calls) external {
        requireOnlySelf();
        for (uint256 i = 0; i < _calls.length; i++) {
            Call memory call = _calls[i];
            require(call.to != address(this), "argent/no-multicall-to-self");
            _execute(call.to, call.value, call.data);
        }
    }

    // Recovery

    function changeOwner(address _newOwner) public {
        requireOnlySelf();
        require(_newOwner != address(0), "argent/null-owner");
        owner = _newOwner;
        emit OwnerChanged(_newOwner);
    }

    function changeGuardian(address _newGuardian) public {
        requireOnlySelf();
        require(_newGuardian != address(0) || guardianBackup == address(0), "argent/guardian-backup-required");
        guardian = _newGuardian;
        emit GuardianChanged(_newGuardian);
    }

    function changeGuardianBackup(address _newGuardianBackup) public {
        requireOnlySelf();
        requireGuardian();
        guardianBackup = _newGuardianBackup;
        emit GuardianBackupChanged(_newGuardianBackup);
    }

    function triggerEscapeOwner() public {
        requireOnlySelf();
        requireGuardian();
        // no escape if there is an guardian escape triggered by the owner in progress
        if (escape.activeAt != 0) {
            require(escape.escapeType == OWNER_ESCAPE, "argent/cannot-override-owner-escape");
        }

        uint32 activeAt = uint32(block.timestamp) + escapeSecurityPeriod;
        escape = Escape(activeAt, OWNER_ESCAPE);
        emit EscapeOwnerTriggerred(activeAt);
    }

    function triggerEscapeGuardian() public {
        requireOnlySelf();
        requireGuardian();
        uint32 activeAt = uint32(block.timestamp) + escapeSecurityPeriod;
        escape = Escape(activeAt, GUARDIAN_ESCAPE);
        emit EscapeGuardianTriggerred(activeAt);
    }

    function cancelEscape() public {
        requireOnlySelf();
        require(escape.activeAt != 0 && escape.escapeType != NO_ESCAPE, "argent/not-escaping");

        delete escape;
        emit EscapeCancelled();
    }

    function escapeOwner(address _newOwner) public {
        requireOnlySelf();
        requireGuardian();
        require(_newOwner != address(0), "argent/null-owner");
        require(escape.activeAt != 0, "argent/not-escaping");
        require(escape.activeAt <= block.timestamp, "argent/inactive-escape");
        require(escape.escapeType == OWNER_ESCAPE, "argent/invalid-escape-type");

        delete escape;
        owner = _newOwner;
        emit OwnerEscaped(_newOwner);
    }

    function escapeGuardian(address _newGuardian) public {
        requireOnlySelf();
        requireGuardian();
        require(_newGuardian != address(0), "argent/null-guardian");
        require(escape.activeAt != 0, "argent/not-escaping");
        require(escape.activeAt <= block.timestamp, "argent/inactive-escape");
        require(escape.escapeType == GUARDIAN_ESCAPE, "argent/invalid-escape-type");

        delete escape;
        guardian = _newGuardian;
        emit GuardianEscaped(_newGuardian);
    }

    function isOwnerEscapeCall(bytes4 _selector) internal pure returns (bool) {
        return _selector == this.escapeOwner.selector || _selector == this.triggerEscapeOwner.selector;
    }

    function isGuardianEscapeCall(bytes4 _selector) internal pure returns (bool) {
        return _selector == this.escapeGuardian.selector || _selector == this.triggerEscapeGuardian.selector;
    }

    function requiredSignatureLength(bytes4 _selector) internal view returns (uint256) {
        if (guardian != address(0) && !isOwnerEscapeCall(_selector) && !isGuardianEscapeCall(_selector)) {
            return 130;
        }
        return 65;
    }

    // IAccount implementation

    function validateTransaction(
        bytes32, // _transactionHash
        bytes32 _suggestedSignedHash,
        Transaction calldata _transaction
    ) external payable override returns (bytes4) {
        requireOnlyBootloader();
        return _validateTransaction(_suggestedSignedHash, _transaction);
    }

    function _validateTransaction(
        bytes32 _suggestedSignedHash,
        Transaction calldata _transaction
    ) internal returns (bytes4 _magic) {
        // no need to check if account is initialized because it's done during proxy deployment
        _magic = ACCOUNT_VALIDATION_SUCCESS_MAGIC;

        SystemContractsCaller.systemCallWithPropagatedRevert(
            uint32(gasleft()),
            address(NONCE_HOLDER_SYSTEM_CONTRACT),
            0,
            abi.encodeCall(INonceHolder.incrementMinNonceIfEquals, (_transaction.nonce))
        );

        bytes32 transactionHash;
        if (_suggestedSignedHash == bytes32(0)) {
            transactionHash = _transaction.encodeHash();
        } else {
            transactionHash = _suggestedSignedHash;
        }

        if (_transaction.to == uint256(uint160(address(DEPLOYER_SYSTEM_CONTRACT)))) {
            require(_transaction.data.length >= 4, "argent/invalid-call-to-deployer");
        }

        // The fact there is are enough balance for the account
        // should be checked explicitly to prevent user paying for fee for a
        // transaction that wouldn't be included on Ethereum.
        uint256 totalRequiredBalance = _transaction.totalRequiredBalance();
        require(totalRequiredBalance <= address(this).balance, "argent/insufficient-funds-for-gas-plus-value");

        bytes memory signature = _transaction.signature;

        // in gas estimation mode, we're called with a single signature filled with zeros
        // substituting the signature with some signature-like array to make sure that the
        // validation step uses as much steps as the validation with the correct signature provided
        uint256 requiredLength = requiredSignatureLength(bytes4(_transaction.data));
        if (signature.length < requiredLength) {
            signature = new bytes(requiredLength);
            signature[64] = bytes1(uint8(27));
            if (requiredLength == 130) {
                signature[129] = bytes1(uint8(27));
            }
        }

        if (!isValidTransaction(transactionHash, _transaction, signature)) {
            _magic = bytes4(0);
        }
    }

    function isValidTransaction(
        bytes32 _transactionHash,
        Transaction calldata _transaction,
        bytes memory _signature
    ) internal view returns (bool) {
        if (_transaction.to == uint256(uint160(address(this)))) {
            bytes4 selector = bytes4(_transaction.data);
            if (isGuardianEscapeCall(selector)) {
                return isValidOwnerSignature(_transactionHash, _signature);
            }
            if (isOwnerEscapeCall(selector)) {
                return isValidGuardianSignature(_transactionHash, _signature);
            }
            if (selector == this.executeAfterUpgrade.selector) {
                return false;
            }
        }
        return _isValidSignature(_transactionHash, _signature);
    }

    function isValidOwnerSignature(bytes32 _hash, bytes memory _ownerSignature) internal view returns (bool) {
        address recovered = Signatures.recoverSigner(_hash, _ownerSignature);
        return recovered != address(0) && recovered == owner;
    }

    function isValidGuardianSignature(bytes32 _hash, bytes memory _guardianSignature) internal view returns (bool) {
        if (guardian == address(0) && _guardianSignature.length == 0) {
            return true;
        }
        address recovered = Signatures.recoverSigner(_hash, _guardianSignature);
        if (recovered == address(0)) {
            return false;
        }
        return recovered == guardian || recovered == guardianBackup;
    }

    function executeTransaction(
        bytes32, // _transactionHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable override {
        requireOnlyBootloader();
        _execute(address(uint160(_transaction.to)), _transaction.value, _transaction.data);
    }

    function executeTransactionFromOutside(Transaction calldata _transaction) external payable override {
        requireOnlyBootloader();
        _validateTransaction(bytes32(0), _transaction); // The account recalculates the hash on its own
        _execute(address(uint160(_transaction.to)), _transaction.value, _transaction.data);
    }

    function _execute(address to, uint256 value, bytes memory data) internal {
        uint128 value128 = Utils.safeCastToU128(value);
        if (to == address(DEPLOYER_SYSTEM_CONTRACT)) {
            uint32 gas = Utils.safeCastToU32(gasleft());
            SystemContractsCaller.systemCallWithPropagatedRevert(gas, to, value128, data);
        } else {
            // using assembly saves us a returndatacopy of the entire return data
            bool success;
            assembly {
                success := call(gas(), to, value128, add(data, 0x20), mload(data), 0, 0)
            }
            require(success);
        }
    }

    function payForTransaction(
        bytes32, // _transactionHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable override {
        requireOnlyBootloader();
        bool success = _transaction.payToTheBootloader();
        require(success, "argent/failed-fee-payment");
    }

    // Here, the user should prepare for the transaction to be paid for by a paymaster
    // Here, the account should set the allowance for the smart contracts
    function prepareForPaymaster(
        bytes32, // _transactionHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable override {
        requireOnlyBootloader();
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

    function isValidSignature(bytes32 _hash, bytes calldata _signature) public view override returns (bytes4 _magic) {
        if (_isValidSignature(_hash, _signature)) {
            _magic = IERC1271.isValidSignature.selector;
        }
    }

    function _isValidSignature(bytes32 _hash, bytes memory _signature) internal view returns (bool) {
        (bytes memory ownerSignature, bytes memory guardianSignature) = Signatures.splitSignatures(_signature);
        return isValidOwnerSignature(_hash, ownerSignature) && isValidGuardianSignature(_hash, guardianSignature);
    }

    // fallback & receive

    fallback() external {
        // fallback of default account shouldn't be called by bootloader under no circumstances
        assert(msg.sender != BOOTLOADER_FORMAL_ADDRESS);

        // If the contract is called directly, behave like an EOA
    }

    receive() external payable {
        // If the contract is called directly, behave like an EOA
    }
}
