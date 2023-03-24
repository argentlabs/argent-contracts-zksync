# Argent Account on zkSync

_Warning: StarkNet is still in alpha, so is this project. In particular the `ArgentAccount.sol` contract has not been audited yet and should not be used to store significant value._

## High-Level Specification

TODO

## Development

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
yarn test test/test-account.ts --network zkSyncTestnet
```

### Deploy on goerli

Run once for every new contract version, the addresses will be stored in `config/`:

```
yarn hardhat run scripts/deploy-infrastructure.ts --network zkSyncTestnet
```

Deploy a new account:

```
yarn hardhat run scripts/deploy-account.ts --network zkSyncTestnet
```
