// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.18;

import {IERC165} from "@openzeppelin/contracts/interfaces/IERC165.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {BOOTLOADER_FORMAL_ADDRESS, DEPLOYER_SYSTEM_CONTRACT, NONCE_HOLDER_SYSTEM_CONTRACT} from "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import {IAccount, ACCOUNT_VALIDATION_SUCCESS_MAGIC} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IAccount.sol";
import {INonceHolder} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/INonceHolder.sol";
import {EfficientCall} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/EfficientCall.sol";
import {SystemContractsCaller} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/SystemContractsCaller.sol";
import {SystemContractHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/SystemContractHelper.sol";
import {Transaction, TransactionHelper, IPaymasterFlow} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/TransactionHelper.sol";
import {Utils} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/Utils.sol";

import {IMulticall} from "../IMulticall.sol";
import {IProxy} from "../Proxy.sol";
import {Signatures} from "../Signatures.sol";

contract ArgentAccountV0dot1dot0 is IAccount, IProxy, IMulticall, IERC165, IERC1271 {
    using TransactionHelper for Transaction;
    using ERC165Checker for address;
    using ECDSA for bytes32;

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

    enum EscapeStatus {
        /// No escape triggered, or it was canceled
        None,
        /// Escape was triggered and it's waiting for the `escapeSecurityPeriod`
        NotReady,
        /// The security period has elapsed and the escape is ready to be completed
        Ready,
        /// No confirmation happened for `escapeExpiryPeriod` since it became `Ready`. The escape cannot be completed now, only canceled
        Expired
    }

    // prettier-ignore
    struct Escape {
        /// timestamp for activation of escape mode, 0 otherwise
        uint32 readyAt;     // bits [0...32[
        /// packed `EscapeType` enum
        uint8 escapeType;   // bits [32...40[
        /// new owner or new guardian address
        address newSigner;  // bits [40...200[
    }

    bytes32 public constant NAME = "ArgentAccount";

    /// Limit escape attempts by only one party
    uint32 public constant MAX_ESCAPE_ATTEMPTS = 5;
    /// Limit escape attempts by only one party
    uint256 public constant MAX_ESCAPE_PRIORITY_FEE = 50 gwei; // Limit gas usage by only one party

    /// Time it takes for the escape to become ready after being triggered
    uint32 public immutable escapeSecurityPeriod;
    /// The escape will be ready and can be completed for this duration
    uint32 public immutable escapeExpiryPeriod;

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                                                     Storage                                                    //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /// Account implementation
    address public implementation; // !!! storage slot shared with proxy
    /// Current account owner
    address public owner;
    /// Current account guardian
    address public guardian;
    /// Current account backup guardian
    address public guardianBackup;
    /// Keeps track of how many escaping tx the guardian has submitted. Used to limit the number of transactions the account will pay for
    uint32 public guardianEscapeAttempts;
    /// Keeps track of how many escaping tx the owner has submitted. Used to limit the number of transactions the account will pay for
    uint32 public ownerEscapeAttempts;
    /// The ongoing escape, if any
    Escape private escape;

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                                                     Events                                                     //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /// @notice Emitted exactly once when the account is initialized
    /// @param owner The owner address
    /// @param guardian The guardian address
    event AccountCreated(address indexed owner, address guardian);

    /// @notice Emitted when the implementation of the account changes
    /// @param newImplementation The new implementation
    event AccountUpgraded(address newImplementation);

    /// @notice Emitted when the account executes a transaction
    /// @param transactionHash The transaction hash
    /// @param returnData The data returned by the method called
    event TransactionExecuted(bytes32 indexed transactionHash, bytes returnData);

    /// @notice The account owner was changed
    /// @param newOwner new owner address
    event OwnerChanged(address newOwner);

    /// @notice The account guardian was changed or removed
    /// @param newGuardian address of the new guardian or 0 if it was removed
    event GuardianChanged(address newGuardian);

    /// @notice The account backup guardian was changed or removed
    /// @param newGuardianBackup address of the backup guardian or 0 if it was removed
    event GuardianBackupChanged(address newGuardianBackup);

    /// @notice Owner escape was triggered by the guardian
    /// @param readyAt when the escape can be completed
    /// @param newOwner new owner address to be set after the security period
    event EscapeOwnerTriggerred(uint32 readyAt, address newOwner);

    /// @notice Guardian escape was triggered by the owner
    /// @param readyAt when the escape can be completed
    /// @param newGuardian address of the new guardian to be set after the security period. O if the guardian will be removed
    event EscapeGuardianTriggerred(uint32 readyAt, address newGuardian);

    /// @notice Owner escape was completed and there is a new account owner
    /// @param newOwner new owner address
    event OwnerEscaped(address newOwner);

    /// @notice Guardian escape was completed and there is a new account guardian
    /// @param newGuardian address of the new guardian or 0 if it was removed
    event GuardianEscaped(address newGuardian);

    /// An ongoing escape was canceled
    event EscapeCanceled();

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                                                    Modifiers                                                   //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    // inlined modifiers for consistency of requirements, easier auditing and some gas savings

    function _requireOnlySelf() private view {
        require(msg.sender == address(this), "argent/only-self");
    }

    function _requireGuardian() private view {
        require(guardian != address(0), "argent/guardian-required");
    }

    function _requireOnlyBootloader() private view {
        require(msg.sender == BOOTLOADER_FORMAL_ADDRESS, "argent/only-bootloader");
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                                                   Constructor                                                  //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    constructor(uint32 _escapeSecurityPeriod) {
        require(_escapeSecurityPeriod != 0, "argent/null-escape-security-period");
        escapeSecurityPeriod = _escapeSecurityPeriod;
        escapeExpiryPeriod = _escapeSecurityPeriod;
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                                                External methods                                                //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /**************************************************** Lifecycle ***************************************************/

    /// Semantic version of this contract
    function version() public pure returns (Version memory) {
        return Version(0, 1, 0);
    }

    /// @dev Sets the initial parameters of the account. It's mandatory to call this method to secure the account.
    /// It's recommended to call this method in the same transaction that deploys the account to make sure it's always initialized
    function initialize(address _owner, address _guardian) external {
        require(_owner != address(0), "argent/null-owner");
        require(owner == address(0), "argent/already-initialized");
        owner = _owner;
        guardian = _guardian;
        emit AccountCreated(_owner, _guardian);
    }

    /// @notice Upgrades the implementation of the account
    /// @dev Also call `executeAfterUpgrade` on the new implementation
    /// Must be called by the account and authorised by the owner and a guardian (if guardian is set).
    /// @param _newImplementation The address of the new implementation
    /// @param _data Data to pass to the the implementation in `executeAfterUpgrade`
    function upgrade(address _newImplementation, bytes calldata _data) external {
        _requireOnlySelf();
        bool isSupported = _newImplementation.supportsInterface(type(IAccount).interfaceId);
        require(isSupported, "argent/invalid-implementation");
        implementation = _newImplementation;
        emit AccountUpgraded(_newImplementation);
        // using delegatecall to run the `executeAfterUpgrade` function of the new implementation
        (bool success, ) = _newImplementation.delegatecall(
            abi.encodeCall(this.executeAfterUpgrade, (version(), _data))
        );
        require(success, "argent/upgrade-callback-failed");
    }

    // @dev Logic to execute after an upgrade.
    // Can only be called by the account after a call to `upgrade`.
    // @param _previousVersion The previous account version
    // @param _data Generic call data that can be passed to the method for future upgrade logic
    function executeAfterUpgrade(Version memory /*_previousVersion*/, bytes calldata /*_data*/) external {
        _requireOnlySelf();
        owner = owner; // useless code to suppress warning about pure function
        // reserved upgrade callback for future account versions
    }

    /// @inheritdoc IAccount
    function payForTransaction(
        bytes32, // _transactionHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable override {
        _requireOnlyBootloader();
        bool success = _transaction.payToTheBootloader();
        require(success, "argent/failed-fee-payment");
    }

    /// @inheritdoc IAccount
    function prepareForPaymaster(
        bytes32, // _transactionHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable override {
        _requireOnlyBootloader();
        require(_transaction.paymasterInput.length >= 4, "argent/invalid-paymaster-data");
        bytes4 paymasterInputSelector = bytes4(_transaction.paymasterInput[0:4]);
        if (paymasterInputSelector == IPaymasterFlow.approvalBased.selector && guardian != address(0)) {
            // The approval paymaster can take account tokens, up to the approved amount.
            // It should be only allowed if both parties agree to the token amount (unless there is no guardian)
            bool isValid = _transaction.signature.length == 2 * Signatures.SINGLE_LENGTH;
            require(isValid, "argent/no-paymaster-with-single-signature");
        }
        _transaction.processPaymasterInput();
    }

    /*************************************************** Validation ***************************************************/

    /// @inheritdoc IAccount
    function validateTransaction(
        bytes32, // _transactionHash
        bytes32 _suggestedSignedHash,
        Transaction calldata _transaction
    ) external payable override returns (bytes4) {
        _requireOnlyBootloader();
        bytes32 transactionHash = _suggestedSignedHash != bytes32(0) ? _suggestedSignedHash : _transaction.encodeHash();
        return _validateTransaction(transactionHash, _transaction, false);
    }

    /// @inheritdoc IERC1271
    function isValidSignature(bytes32 _hash, bytes calldata _signature) public view override returns (bytes4) {
        if (_isValidSignature(_hash, _signature)) {
            return IERC1271.isValidSignature.selector;
        }
        return bytes4(0);
    }

    /**************************************************** Execution ***************************************************/

    /// @inheritdoc IMulticall
    function multicall(IMulticall.Call[] calldata _calls) external returns (bytes[] memory _returnData) {
        _requireOnlySelf();
        _returnData = new bytes[](_calls.length);
        for (uint256 i = 0; i < _calls.length; i++) {
            IMulticall.Call calldata call = _calls[i];
            require(call.to != address(this), "argent/no-multicall-to-self");
            _returnData[i] = _execute(call.to, call.value, call.data);
        }
    }

    /// @inheritdoc IAccount
    function executeTransaction(
        bytes32 _transactionHash,
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable override {
        _requireOnlyBootloader();
        bytes memory returnData = _execute(address(uint160(_transaction.to)), _transaction.value, _transaction.data);
        emit TransactionExecuted(_transactionHash, returnData);
    }

    /// @inheritdoc IAccount
    function executeTransactionFromOutside(Transaction calldata _transaction) external payable override {
        bytes32 transactionHash = _transaction.encodeHash();
        bytes4 result = _validateTransaction(transactionHash, _transaction, true);
        require(result == ACCOUNT_VALIDATION_SUCCESS_MAGIC, "argent/invalid-transaction");
        bytes memory returnData = _execute(address(uint160(_transaction.to)), _transaction.value, _transaction.data);
        emit TransactionExecuted(transactionHash, returnData);
    }

    /**************************************************** Recovery ****************************************************/

    /// Current escape if any, and its status
    function escapeAndStatus() external view returns (Escape memory, EscapeStatus) {
        return (escape, _escapeStatus(escape));
    }

    /// @notice Changes the owner
    /// Must be called by the account and authorised by the owner and a guardian (if guardian is set).
    /// @param _newOwner New owner address
    /// @param _signature Signature from the new owner to prevent changing to an address which is not in control of the user
    /// Signature is the Ethereum Signed Message of this hash:
    /// hash = keccak256(abi.encodePacked(changeOwner.selector, block.chainid, accountAddress, oldOwner))
    function changeOwner(address _newOwner, bytes memory _signature) external {
        _requireOnlySelf();
        _validateNewOwner(_newOwner, _signature);

        _resetEscape();
        _resetEscapeAttempts();
        owner = _newOwner;
        emit OwnerChanged(_newOwner);
    }

    /// @notice Changes the guardian
    /// Must be called by the account and authorised by the owner and a guardian (if guardian is set).
    /// @param _newGuardian The address of the new guardian, or 0 to disable the guardian
    function changeGuardian(address _newGuardian) external {
        _requireOnlySelf();
        require(_newGuardian != address(0) || guardianBackup == address(0), "argent/backup-should-be-null");

        _resetEscape();
        _resetEscapeAttempts();
        guardian = _newGuardian;
        emit GuardianChanged(_newGuardian);
    }

    /// @notice Changes the backup guardian
    /// Must be called by the account and authorised by the owner and a guardian (if guardian is set).
    /// @param _newGuardianBackup The address of the new backup guardian, or 0 to disable the backup guardian
    function changeGuardianBackup(address _newGuardianBackup) external {
        _requireOnlySelf();
        _requireGuardian();

        _resetEscape();
        _resetEscapeAttempts();
        guardianBackup = _newGuardianBackup;
        emit GuardianBackupChanged(_newGuardianBackup);
    }

    /// @notice Triggers the escape of the owner when it is lost or compromised.
    /// Must be called by the account and authorised by just a guardian.
    /// Cannot override an ongoing escape of the guardian.
    /// @param _newOwner The new account owner if the escape completes
    /// @dev
    /// This method assumes that there is a guardian, and that `_newOwner` is not 0
    /// This must be guaranteed before calling this method. Usually when validating the transaction
    function triggerEscapeOwner(address _newOwner) external {
        _requireOnlySelf();
        // no escape if there is an guardian escape triggered by the owner in progress
        if (escape.escapeType == uint8(EscapeType.Guardian)) {
            require(_escapeStatus(escape) == EscapeStatus.Expired, "argent/cannot-override-escape");
        }

        _resetEscape();
        uint32 readyAt = uint32(block.timestamp) + escapeSecurityPeriod;
        escape = Escape(readyAt, uint8(EscapeType.Owner), _newOwner);
        emit EscapeOwnerTriggerred(readyAt, _newOwner);
    }

    /// @notice Triggers the escape of the guardian when it is lost or compromised.
    /// Must be called by the account and authorised by the owner alone.
    /// Can override an ongoing escape of the owner.
    /// @param _newGuardian The new account guardian if the escape completes
    /// @dev
    /// This method assumes that there is a guardian
    /// This must be guaranteed before calling this method. Usually when validating the transaction
    function triggerEscapeGuardian(address _newGuardian) external {
        _requireOnlySelf();

        _resetEscape();
        uint32 readyAt = uint32(block.timestamp) + escapeSecurityPeriod;
        escape = Escape(readyAt, uint8(EscapeType.Guardian), _newGuardian);
        emit EscapeGuardianTriggerred(readyAt, _newGuardian);
    }

    /// @notice Cancels an ongoing escape if any.
    /// Must be called by the account and authorised by the owner and a guardian (if guardian is set).
    function cancelEscape() external {
        _requireOnlySelf();
        require(_escapeStatus(escape) != EscapeStatus.None, "argent/invalid-escape");
        _resetEscape();
        _resetEscapeAttempts();
    }

    /// @notice Completes the escape and changes the owner after the security period
    /// Must be called by the account and authorised by just a guardian
    /// @dev
    /// This method assumes that there is a guardian, and that the there is an escape for the owner
    /// This must be guaranteed before calling this method. Usually when validating the transaction
    function escapeOwner() external {
        _requireOnlySelf();
        require(_escapeStatus(escape) == EscapeStatus.Ready, "argent/invalid-escape");

        _resetEscapeAttempts();
        owner = escape.newSigner;
        emit OwnerEscaped(escape.newSigner);
        delete escape;
    }

    /// @notice Completes the escape and changes the guardian after the security period
    /// Must be called by the account and authorised by just the owner
    /// @dev
    /// This method assumes that there is a guardian, and that the there is an escape for the guardian
    /// This must be guaranteed before calling this method. Usually when validating the transaction
    function escapeGuardian() external {
        _requireOnlySelf();
        require(_escapeStatus(escape) == EscapeStatus.Ready, "argent/invalid-escape");

        _resetEscapeAttempts();
        guardian = escape.newSigner;
        emit GuardianEscaped(escape.newSigner);
        delete escape;
    }

    /************************************************** Miscellaneous *************************************************/

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 _interfaceId) external pure override returns (bool) {
        // NOTE: it's more efficient to use a mapping based implementation if there are more than 3 interfaces
        return
            _interfaceId == type(IERC165).interfaceId ||
            _interfaceId == type(IERC1271).interfaceId ||
            _interfaceId == type(IMulticall).interfaceId ||
            _interfaceId == type(IAccount).interfaceId;
    }

    fallback() external payable {
        // fallback of default account shouldn't be called by bootloader under no circumstances
        assert(msg.sender != BOOTLOADER_FORMAL_ADDRESS);

        // If the contract is called directly, behave like an EOA
    }

    receive() external payable {
        // If the contract is called directly, behave like an EOA
    }

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                                                    Internal                                                    //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    /*************************************************** Validation ***************************************************/

    function _validateTransaction(
        bytes32 _transactionHash,
        Transaction calldata _transaction,
        bool _isFromOutside
    ) private returns (bytes4) {
        require(owner != address(0), "argent/uninitialized");

        SystemContractsCaller.systemCallWithPropagatedRevert(
            uint32(gasleft()),
            address(NONCE_HOLDER_SYSTEM_CONTRACT),
            0,
            abi.encodeCall(INonceHolder.incrementMinNonceIfEquals, (_transaction.nonce))
        );

        address to = address(uint160(_transaction.to));
        bytes4 selector = bytes4(_transaction.data);
        bytes memory signature = _transaction.signature;

        if (!_isFromOutside) {
            // The fact there is are enough balance for the account
            // should be checked explicitly to prevent user paying for fee for a
            // transaction that wouldn't be included on Ethereum.
            uint256 totalRequiredBalance = _transaction.totalRequiredBalance();
            require(totalRequiredBalance <= address(this).balance, "argent/insufficient-funds-for-gas-plus-value");
        }

        // in gas estimation mode, we're called with a single signature filled with zeros
        // substituting the signature with some signature-like array to make sure that the
        // validation step uses as much steps as the validation with the correct signature provided
        uint256 requiredLength = _requiredSignatureLength(selector);
        if (signature.length < requiredLength) {
            signature = new bytes(requiredLength);
            signature[Signatures.SINGLE_LENGTH - 1] = bytes1(uint8(27));
            if (requiredLength == 2 * Signatures.SINGLE_LENGTH) {
                signature[(2 * Signatures.SINGLE_LENGTH) - 1] = bytes1(uint8(27));
            }
        }

        if (to == address(this)) {
            if (selector == this.triggerEscapeOwner.selector) {
                if (!_isFromOutside) {
                    require(_transaction.maxPriorityFeePerGas <= MAX_ESCAPE_PRIORITY_FEE, "argent/tip-too-high");
                    require(guardianEscapeAttempts < MAX_ESCAPE_ATTEMPTS, "argent/max-escape-attempts");
                    guardianEscapeAttempts++;
                }
                require(_transaction.data.length == 4 + 32, "argent/invalid-call-data");
                address newOwner = abi.decode(_transaction.data[4:], (address)); // This also asserts that the call data is valid
                require(newOwner != address(0), "argent/null-owner");
                _requireGuardian();

                if (_isValidGuardianSignature(_transactionHash, signature)) {
                    return ACCOUNT_VALIDATION_SUCCESS_MAGIC;
                }
                return bytes4(0);
            }

            if (selector == this.escapeOwner.selector) {
                if (!_isFromOutside) {
                    require(_transaction.maxPriorityFeePerGas <= MAX_ESCAPE_PRIORITY_FEE, "argent/tip-too-high");
                    require(guardianEscapeAttempts < MAX_ESCAPE_ATTEMPTS, "argent/max-escape-attempts");
                    guardianEscapeAttempts++;
                }
                require(_transaction.data.length == 4, "argent/invalid-call-data");
                _requireGuardian();
                require(escape.escapeType == uint8(EscapeType.Owner), "argent/invalid-escape");
                if (_isValidGuardianSignature(_transactionHash, signature)) {
                    return ACCOUNT_VALIDATION_SUCCESS_MAGIC;
                }
                return bytes4(0);
            }

            if (selector == this.triggerEscapeGuardian.selector) {
                if (!_isFromOutside) {
                    require(_transaction.maxPriorityFeePerGas <= MAX_ESCAPE_PRIORITY_FEE, "argent/tip-too-high");
                    require(ownerEscapeAttempts < MAX_ESCAPE_ATTEMPTS, "argent/max-escape-attempts");
                    ownerEscapeAttempts++;
                }
                require(_transaction.data.length == 4 + 32, "argent/invalid-call-data");
                abi.decode(_transaction.data[4:], (address)); // This asserts that the call data is valid
                _requireGuardian();
                if (_isValidOwnerSignature(_transactionHash, signature)) {
                    return ACCOUNT_VALIDATION_SUCCESS_MAGIC;
                }
                return bytes4(0);
            }

            if (selector == this.escapeGuardian.selector) {
                if (!_isFromOutside) {
                    require(_transaction.maxPriorityFeePerGas <= MAX_ESCAPE_PRIORITY_FEE, "argent/tip-too-high");
                    require(ownerEscapeAttempts < MAX_ESCAPE_ATTEMPTS, "argent/max-escape-attempts");
                    ownerEscapeAttempts++;
                }
                require(_transaction.data.length == 4, "argent/invalid-call-data");
                _requireGuardian();
                require(escape.escapeType == uint8(EscapeType.Guardian), "argent/invalid-escape");
                if (_isValidOwnerSignature(_transactionHash, signature)) {
                    return ACCOUNT_VALIDATION_SUCCESS_MAGIC;
                }
                return bytes4(0);
            }

            require(selector != this.executeAfterUpgrade.selector, "argent/forbidden-call");
        }

        if (_isValidSignature(_transactionHash, signature)) {
            return ACCOUNT_VALIDATION_SUCCESS_MAGIC;
        }
        return bytes4(0);
    }

    function _requiredSignatureLength(bytes4 _selector) private view returns (uint256) {
        if (guardian == address(0) || _isOwnerEscapeCall(_selector) || _isGuardianEscapeCall(_selector)) {
            return Signatures.SINGLE_LENGTH;
        }
        return 2 * Signatures.SINGLE_LENGTH;
    }

    function _isValidOwnerSignature(bytes32 _hash, bytes memory _ownerSignature) private view returns (bool) {
        address signer = Signatures.recoverSigner(_hash, _ownerSignature);
        return signer != address(0) && signer == owner;
    }

    function _isValidGuardianSignature(bytes32 _hash, bytes memory _guardianSignature) private view returns (bool) {
        address signer = Signatures.recoverSigner(_hash, _guardianSignature);
        return signer != address(0) && (signer == guardian || signer == guardianBackup);
    }

    function _isValidSignature(bytes32 _hash, bytes memory _signature) private view returns (bool) {
        (bytes memory ownerSignature, bytes memory guardianSignature) = Signatures.splitSignatures(_signature);
        // always doing both ecrecovers to have proper gas estimation of validation step
        bool ownerIsValid = _isValidOwnerSignature(_hash, ownerSignature);
        bool guardianIsValid = _isValidGuardianSignature(_hash, guardianSignature);
        if (!ownerIsValid) {
            return false;
        }
        if (guardian == address(0)) {
            return guardianSignature.length == 0;
        }
        return guardianIsValid;
    }

    function _validateNewOwner(address _newOwner, bytes memory _signature) private view {
        require(_newOwner != address(0), "argent/null-owner");
        bytes4 selector = this.changeOwner.selector;
        bytes memory message = abi.encodePacked(selector, block.chainid, address(this), owner);
        bytes32 messageHash = keccak256(message).toEthSignedMessageHash();
        address signer = Signatures.recoverSigner(messageHash, _signature);
        require(signer != address(0) && signer == _newOwner, "argent/invalid-owner-sig");
    }

    /**************************************************** Execution ***************************************************/

    function _execute(address to, uint256 value, bytes calldata data) private returns (bytes memory) {
        uint128 value128 = Utils.safeCastToU128(value);
        uint32 gas = Utils.safeCastToU32(gasleft());

        // Note, that the deployment method from the deployer contract can only be called with a "systemCall" flag.
        bool isSystemCall;
        if (to == address(DEPLOYER_SYSTEM_CONTRACT) && data.length >= 4) {
            bytes4 selector = bytes4(data[:4]);
            // Check that called function is the deployment method,
            // the others deployer method is not supposed to be called from the default account.
            isSystemCall =
                selector == DEPLOYER_SYSTEM_CONTRACT.create.selector ||
                selector == DEPLOYER_SYSTEM_CONTRACT.create2.selector ||
                selector == DEPLOYER_SYSTEM_CONTRACT.createAccount.selector ||
                selector == DEPLOYER_SYSTEM_CONTRACT.create2Account.selector;
        }
        return EfficientCall.call(gas, to, value128, data, isSystemCall);
    }

    /**************************************************** Recovery ****************************************************/

    function _resetEscape() private {
        EscapeStatus status = _escapeStatus(escape);
        if (status != EscapeStatus.None) {
            delete escape;
            if (status != EscapeStatus.Expired) {
                emit EscapeCanceled();
            }
        }
    }

    function _resetEscapeAttempts() private {
        ownerEscapeAttempts = 0;
        guardianEscapeAttempts = 0;
    }

    function _escapeStatus(Escape memory _escape) private view returns (EscapeStatus) {
        if (_escape.readyAt == 0) {
            return EscapeStatus.None;
        }
        if (block.timestamp < _escape.readyAt) {
            return EscapeStatus.NotReady;
        }
        if (_escape.readyAt + escapeExpiryPeriod <= block.timestamp) {
            return EscapeStatus.Expired;
        }
        return EscapeStatus.Ready;
    }

    function _isOwnerEscapeCall(bytes4 _selector) private pure returns (bool) {
        return _selector == this.escapeOwner.selector || _selector == this.triggerEscapeOwner.selector;
    }

    function _isGuardianEscapeCall(bytes4 _selector) private pure returns (bool) {
        return _selector == this.escapeGuardian.selector || _selector == this.triggerEscapeGuardian.selector;
    }
}
