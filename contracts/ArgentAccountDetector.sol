//SPDX-License-Identifier: Unlicense
pragma solidity 0.8.18;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IProxy} from "./Proxy.sol";

/**
 * @title ArgentAccountDetector
 * @notice Simple contract to detect if a given address represents an Argent account.
 * The `isArgentAccount` method returns true if the codehash matches one of the deployed Proxy
 * and if the target implementation matches one of the deployed `ArgentAccount`s.
 * Only the owner of the contract can add code hash and implementations.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract ArgentAccountDetector is Ownable {
    // The accepted code hashes
    bytes32[] private codes;
    // The accepted implementations
    address[] private implementations;
    // mapping to efficiently check if a code is accepted
    mapping(bytes32 => Info) public acceptedCodes;
    // mapping to efficiently check is an implementation is accepted
    mapping(address => Info) public acceptedImplementations;

    struct Info {
        bool exists;
        uint128 index;
    }

    // emits when a new accepted code is added
    event CodeAdded(bytes32 indexed code);
    // emits when a new accepted implementation is added
    event ImplementationAdded(address indexed implementation);

    constructor(bytes32[] memory _codes, address[] memory _implementations) {
        for (uint256 i = 0; i < _codes.length; i++) {
            addCode(_codes[i]);
        }
        for (uint256 j = 0; j < _implementations.length; j++) {
            addImplementation(_implementations[j]);
        }
    }

    /**
     * @notice Adds a new accepted code hash.
     * @param _code The new code hash.
     */
    function addCode(bytes32 _code) public onlyOwner {
        require(_code != bytes32(0), "AWR: empty _code");
        Info storage code = acceptedCodes[_code];
        if (!code.exists) {
            codes.push(_code);
            code.exists = true;
            code.index = uint128(codes.length - 1);
            emit CodeAdded(_code);
        }
    }

    /**
     * @notice Adds a new accepted implementation.
     * @param _impl The new implementation.
     */
    function addImplementation(address _impl) public onlyOwner {
        require(_impl != address(0), "AWR: empty _impl");
        Info storage impl = acceptedImplementations[_impl];
        if (!impl.exists) {
            implementations.push(_impl);
            impl.exists = true;
            impl.index = uint128(implementations.length - 1);
            emit ImplementationAdded(_impl);
        }
    }

    /**
     * @notice Adds a new accepted code hash and implementation from a deployed Argent account.
     * @param _argentAccount The deployed Argent account.
     */
    function addCodeAndImplementationFromAccount(address _argentAccount) external onlyOwner {
        bytes32 codeHash;
        assembly {
            codeHash := extcodehash(_argentAccount)
        }
        addCode(codeHash);
        address implementation = IProxy(_argentAccount).implementation();
        addImplementation(implementation);
    }

    /**
     * @notice Gets the list of accepted implementations.
     */
    function getImplementations() public view returns (address[] memory) {
        return implementations;
    }

    /**
     * @notice Gets the list of accepted code hash.
     */
    function getCodes() public view returns (bytes32[] memory) {
        return codes;
    }

    /**
     * @notice Checks if an address is an Argent account
     * @param _account The target account
     */
    function isArgentAccount(address _account) external view returns (bool) {
        return _isArgentAccount(_account);
    }

    /**
     * @notice Checks if an address is an Argent account
     * @param _account The target account
     */
    function _isArgentAccount(address _account) internal view returns (bool) {
        bytes32 codeHash;
        assembly {
            codeHash := extcodehash(_account)
        }
        return acceptedCodes[codeHash].exists && acceptedImplementations[IProxy(_account).implementation()].exists;
    }
}
