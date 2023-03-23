//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.18;

import {IERC165} from "@openzeppelin/contracts/interfaces/IERC165.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ERC165Checker} from "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {BOOTLOADER_FORMAL_ADDRESS, DEPLOYER_SYSTEM_CONTRACT, NONCE_HOLDER_SYSTEM_CONTRACT} from "@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol";
import {IAccount, ACCOUNT_VALIDATION_SUCCESS_MAGIC} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IAccount.sol";
import {INonceHolder} from "@matterlabs/zksync-contracts/l2/system-contracts/interfaces/INonceHolder.sol";
import {SystemContractsCaller} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/SystemContractsCaller.sol";
import {SystemContractHelper} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/SystemContractHelper.sol";
import {Transaction, TransactionHelper, IPaymasterFlow} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/TransactionHelper.sol";
import {Utils} from "@matterlabs/zksync-contracts/l2/system-contracts/libraries/Utils.sol";

import {IMulticall} from "./IMulticall.sol";
import {IProxy} from "./Proxy.sol";
import {Signatures} from "./Signatures.sol";

contract ArgentAccount is IAccount, IProxy, IMulticall, IERC165, IERC1271 {
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
        None,
        Pending,
        Active,
        Expired
    }

    // prettier-ignore
    struct Escape {
        uint32 activeAt;    // bits [0...32[    timestamp for activation of escape mode, 0 otherwise
        uint8 escapeType;   // bits [32...40[   packed EscapeType enum
        address newSigner;  // bits [40...200[  new owner or new guardian
    }

    bytes32 public constant NAME = "ArgentAccount";
    uint32 public constant MAX_ESCAPE_ATTEMPTS = 5; // Limit escape attempts by only one party
    uint256 public constant MAX_ESCAPE_PRIORITY_FEE = 50 gwei; // Limit gas usage by only one party

    uint32 public immutable escapeSecurityPeriod;
    uint32 public immutable escapeExpiryPeriod;

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                                                     Storage                                                    //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    address public implementation; // !!! storage slot shared with proxy
    address public owner;
    address public guardian;
    address public guardianBackup;
    // escape attempts keeps track of how many escaping tx the guardian/owner has submitted. Used to limit the number of transactions the account will pay for
    uint32 public guardianEscapeAttempts;
    uint32 public ownerEscapeAttempts;
    Escape private escape;

    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    //                                                     Events                                                     //
    ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    event AccountCreated(address account, address indexed owner, address guardian);
    event AccountUpgraded(address newImplementation);
    event TransactionExecuted(bytes32 hashed, bytes response);

    event OwnerChanged(address newOwner);
    event GuardianChanged(address newGuardian);
    event GuardianBackupChanged(address newGuardianBackup);

    event EscapeOwnerTriggerred(uint32 activeAt, address newOwner);
    event EscapeGuardianTriggerred(uint32 activeAt, address newGuardian);
    event OwnerEscaped(address newOwner);
    event GuardianEscaped(address newGuardian);
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

    function version() public pure returns (Version memory) {
        return Version(0, 1, 0);
    }

    function initialize(address _owner, address _guardian) external {
        require(_owner != address(0), "argent/null-owner");
        require(owner == address(0), "argent/already-initialized");
        owner = _owner;
        guardian = _guardian;
        emit AccountCreated(address(this), _owner, _guardian);
    }

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

    // only callable by `upgrade`, enforced in `validateTransaction` and `multicall`
    function executeAfterUpgrade(Version memory /*_previousVersion*/, bytes calldata /*_data*/) external {
        _requireOnlySelf();
        owner = owner; // useless code to suppress warning about pure function
        // reserved upgrade callback for future account versions
    }

    // IAccount
    function payForTransaction(
        bytes32, // _transactionHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable override {
        _requireOnlyBootloader();
        bool success = _transaction.payToTheBootloader();
        require(success, "argent/failed-fee-payment");
    }

    // IAccount
    // Here, the user should prepare for the transaction to be paid for by a paymaster
    // Here, the account should set the allowance for the smart contracts
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

    // IAccount
    function validateTransaction(
        bytes32, // _transactionHash
        bytes32 _suggestedSignedHash,
        Transaction calldata _transaction
    ) external payable override returns (bytes4) {
        _requireOnlyBootloader();
        bytes32 transactionHash = _suggestedSignedHash != bytes32(0) ? _suggestedSignedHash : _transaction.encodeHash();
        return _validateTransaction(transactionHash, _transaction, false);
    }

    // IERC1271
    function isValidSignature(bytes32 _hash, bytes calldata _signature) public view override returns (bytes4 _magic) {
        if (_isValidSignature(_hash, _signature)) {
            _magic = IERC1271.isValidSignature.selector;
        }
    }

    /**************************************************** Execution ***************************************************/

    // IMulticall
    function multicall(IMulticall.Call[] memory _calls) external {
        _requireOnlySelf();
        for (uint256 i = 0; i < _calls.length; i++) {
            IMulticall.Call memory call = _calls[i];
            require(call.to != address(this), "argent/no-multicall-to-self");
            _execute(call.to, call.value, call.data);
        }
    }

    // IAccount
    function executeTransaction(
        bytes32, // _transactionHash
        bytes32, // _suggestedSignedHash
        Transaction calldata _transaction
    ) external payable override {
        _requireOnlyBootloader();
        _execute(address(uint160(_transaction.to)), _transaction.value, _transaction.data);
    }

    // IAccount
    function executeTransactionFromOutside(Transaction calldata _transaction) external payable override {
        bytes4 result = _validateTransaction(_transaction.encodeHash(), _transaction, true);
        require(result == ACCOUNT_VALIDATION_SUCCESS_MAGIC, "argent/invalid-transaction");
        _execute(address(uint160(_transaction.to)), _transaction.value, _transaction.data);
    }

    /**************************************************** Recovery ****************************************************/

    function escapeAndStatus() external view returns (Escape memory, EscapeStatus) {
        return (escape, _escapeStatus(escape));
    }

    function changeOwner(address _newOwner, bytes memory _signature) external {
        _requireOnlySelf();
        _validateNewOwner(_newOwner, _signature);

        _cancelEscapeIfAny();
        _resetEscapeAttempts();
        owner = _newOwner;
        emit OwnerChanged(_newOwner);
    }

    function changeGuardian(address _newGuardian) external {
        _requireOnlySelf();
        require(_newGuardian != address(0) || guardianBackup == address(0), "argent/backup-should-be-null");

        _cancelEscapeIfAny();
        _resetEscapeAttempts();
        guardian = _newGuardian;
        emit GuardianChanged(_newGuardian);
    }

    function changeGuardianBackup(address _newGuardianBackup) external {
        _requireOnlySelf();
        _requireGuardian();

        _cancelEscapeIfAny();
        _resetEscapeAttempts();
        guardianBackup = _newGuardianBackup;
        emit GuardianBackupChanged(_newGuardianBackup);
    }

    function triggerEscapeOwner(address _newOwner) external {
        _requireOnlySelf();
        // no escape if there is an guardian escape triggered by the owner in progress
        if (escape.escapeType == uint8(EscapeType.Guardian)) {
            require(_escapeStatus(escape) == EscapeStatus.Expired, "argent/cannot-override-escape");
        }

        _cancelEscapeIfAny();
        uint32 activeAt = uint32(block.timestamp) + escapeSecurityPeriod;
        escape = Escape(activeAt, uint8(EscapeType.Owner), _newOwner);
        emit EscapeOwnerTriggerred(activeAt, _newOwner);
    }

    function triggerEscapeGuardian(address _newGuardian) external {
        _requireOnlySelf();

        _cancelEscapeIfAny();
        uint32 activeAt = uint32(block.timestamp) + escapeSecurityPeriod;
        escape = Escape(activeAt, uint8(EscapeType.Guardian), _newGuardian);
        emit EscapeGuardianTriggerred(activeAt, _newGuardian);
    }

    function cancelEscape() external {
        _requireOnlySelf();
        require(_escapeStatus(escape) != EscapeStatus.None, "argent/null-escape");
        _cancelEscapeIfAny();
    }

    function escapeOwner() external {
        _requireOnlySelf();
        // This method assumes that there is a guardian, and that the there is an escape for the owner
        // This must be guaranteed before calling this method. Usually when validating the transaction
        require(_escapeStatus(escape) == EscapeStatus.Active, "argent/invalid-escape");

        _resetEscapeAttempts();
        owner = escape.newSigner;
        emit OwnerEscaped(escape.newSigner);
        delete escape;
    }

    function escapeGuardian() external {
        _requireOnlySelf();
        // this method assumes that there is a guardian, and that the there is an escape for the guardian
        // This must be guaranteed before calling this method. Usually when validating the transaction
        require(_escapeStatus(escape) == EscapeStatus.Active, "argent/invalid-escape");

        _resetEscapeAttempts();
        guardian = escape.newSigner;
        emit GuardianEscaped(escape.newSigner);
        delete escape;
    }

    /************************************************** Miscellaneous *************************************************/

    // IERC165
    function supportsInterface(bytes4 _interfaceId) external pure override returns (bool) {
        // NOTE: it's more efficient to use a mapping based implementation if there are more than 3 interfaces
        return
            _interfaceId == type(IERC165).interfaceId ||
            _interfaceId == type(IERC1271).interfaceId ||
            _interfaceId == type(IMulticall).interfaceId ||
            _interfaceId == type(IAccount).interfaceId;
    }

    fallback() external {
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

        if (to == address(DEPLOYER_SYSTEM_CONTRACT)) {
            require(_transaction.data.length >= 4, "argent/invalid-call-to-deployer");
        }

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

    function _execute(address to, uint256 value, bytes memory data) private {
        uint128 value128 = Utils.safeCastToU128(value);
        if (to == address(DEPLOYER_SYSTEM_CONTRACT)) {
            uint32 gas = Utils.safeCastToU32(gasleft());
            SystemContractsCaller.systemCallWithPropagatedRevert(gas, to, value128, data);
        } else {
            // using assembly saves us a returndatacopy of the entire return data
            assembly {
                let success := call(gas(), to, value, add(data, 0x20), mload(data), 0, 0)
                if iszero(success) {
                    let size := returndatasize()
                    returndatacopy(0, 0, size)
                    revert(0, size)
                }
            }
        }
    }

    /**************************************************** Recovery ****************************************************/

    function _cancelEscapeIfAny() private {
        if (_escapeStatus(escape) != EscapeStatus.None) {
            delete escape;
            emit EscapeCanceled();
        }
    }

    function _resetEscapeAttempts() private {
        ownerEscapeAttempts = 0;
        guardianEscapeAttempts = 0;
    }

    function _escapeStatus(Escape memory _escape) private view returns (EscapeStatus) {
        if (_escape.activeAt == 0) {
            return EscapeStatus.None;
        }
        if (block.timestamp < _escape.activeAt) {
            return EscapeStatus.Pending;
        }
        if (_escape.activeAt + escapeExpiryPeriod <= block.timestamp) {
            return EscapeStatus.Expired;
        }
        return EscapeStatus.Active;
    }

    function _isOwnerEscapeCall(bytes4 _selector) private pure returns (bool) {
        return _selector == this.escapeOwner.selector || _selector == this.triggerEscapeOwner.selector;
    }

    function _isGuardianEscapeCall(bytes4 _selector) private pure returns (bool) {
        return _selector == this.escapeGuardian.selector || _selector == this.triggerEscapeGuardian.selector;
    }
}
