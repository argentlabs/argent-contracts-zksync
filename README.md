# Argent Account on zkSync

_Warning: zkSync Era is still in alpha, so is this project. In particular the `ArgentAccount.sol` contract has not been audited yet and should not be used to store significant value._

# Overview

The account is similar to a 2-of-2 multisig. With two parties with different roles, the `owner` and the `guardian`. 

The `owner` key is under user control. Typically stored on the user's phone. Users must keep a safe back up of this key.

The `guardian` is both as a co-validator for typical operations of the wallet (including fraud monitoring), and an actor that can help recover the wallet in case the `owner` key is lost or compromised.

It's important to note that the `guardian` alone will not have control over the wallet. Normal operations of the wallet require the approval of both parties to be executed.

The user can always opt-out of the guardian service and manage the account himself, losing the protection offered by the guardian. 

Alternatively, he/she can add a second `guardian_backup` key to the account. It can be used as a replacement for the `guardian`. This will provide the highest guarantee for guardian censorship resistance.

Under this model we can build a simple yet highly secure non-custodial wallet.

## Escape
In case one party is not cooperating (maybe keys were lost or compromised), the other party alone can trigger the `escape` mode (a.k.a. recovery) on the wallet.

An escape takes 7 days before being ready. After the time delay, the non-cooperating party can be replaced ("escaped").

The wallet is asymmetric in favor of the `owner` who can override an escape triggered by the `guardian`. So in case both parties try to escape each other the `owner` has the upper hand.

A triggered escape can always be canceled with the approval of both parties.


## Upgrade
To enable the model to evolve if needed, the account is a proxy to a target implementation. Upgrading to a new implementation requires the approval of both the `owner` and a `guardian`.


## Required signatures in each method

| Action | Owner | Guardian | Comments |
|--------|--------|----------|----------|
| regular transaction | X | X | |
| `upgrade` | X | X | |
| `changeOwner` | X | X | |
| `changeGuardian` | X | X | |
| `changeGuardianBackup` | X | X | |
| `cancelEscape` | X | X | |
| `triggerEscapeOwner` | | X | Fails if guardian escape in progress |
| `escapeOwner` | | X | After security period |
| `triggerEscapeGuardian` | X | | Overrides an owner escape in progress |
| `escapeGuardian` | X | | After security period |


# Development

### Local setup

Install Docker Desktop.

```
yarn
```

This will install the latest zkSync local node in `local-setup/` and pull its Docker images.

### Use the local node

```
yarn start
yarn stop
```

### Compile the contracts

```
yarn hardhat compile
```

### Test the contracts

Locally:

```
yarn test
```

On goerli:

```
yarn test test/account.test.ts --network zkSyncTestnet
```

### Deploy on goerli

Run once for every new contract version, the addresses will be stored in `config/`:

```
VERIFY=true yarn hardhat run scripts/deploy-infrastructure.ts --network zkSyncTestnet
```

Deploy a new account:

```
VERIFY=true yarn hardhat run scripts/deploy-account.ts --network zkSyncTestnet
```
