#!/bin/bash

# Starts a local zkSync node and releases control when the RPC endpoint is ready.

set -e # stop the script if any subprocess fails

echo Starting zkSync node...

cd local-setup
./start.sh | grep '^local-setup-zksync' &
cd ..

result=""
until [[ "$result" == *"zkSync"* ]]; do
	result=$(curl http://localhost:3050 \
		--silent \
		--header 'Content-Type: application/json' \
		--data '{"jsonrpc": "2.0", "id": "1", "method": "web3_clientVersion", "params": []}' \
		|| true)
	sleep 1
done

echo Node ready.
