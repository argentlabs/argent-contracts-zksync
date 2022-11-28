// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {Transaction} from "@matterlabs/zksync-contracts/l2/system-contracts/TransactionHelper.sol";

import {SponsorPaymaster} from "./SponsorPaymaster.sol";

contract DappWhitelistPaymaster is SponsorPaymaster {
    event Whitelisted(address _address);
    event Unwhitelisted(address _address);

    // The allowed target addresses
    mapping(address => bool) public whitelist;

    constructor(address[] memory _whitelist) {
        for (uint256 i = 0; i < _whitelist.length; i++) {
            whitelistDapp(_whitelist[i]);
        }
    }

    function isSponsoredTransaction(Transaction calldata _transaction) internal view override returns (bool) {
        return whitelist[address(uint160(_transaction.to))];
    }

    function whitelistDapp(address _address) public onlyOwner {
        require(_address != address(0), "null _address");
        require(!whitelist[_address], "Already whitelisted");
        whitelist[_address] = true;
        emit Whitelisted(_address);
    }

    function unwhitelistDapp(address _address) public onlyOwner {
        require(_address != address(0), "null _address");
        require(whitelist[_address], "Not whitelisted");
        delete whitelist[_address];
        emit Unwhitelisted(_address);
    }
}
