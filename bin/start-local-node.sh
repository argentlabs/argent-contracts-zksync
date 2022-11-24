#!/bin/bash

set -e # stop the script if any subprocess fails

echo Starting zkSync node and waiting until it is ready

cd local-setup
./start.sh >/dev/null | grep '^local-setup-zksync' &
cd ..

result=""
until [[ "$result" == *"zkSync"* ]]; do
	result=$(curl http://localhost:3050 \
		--silent \
		--header 'Content-Type: application/json' \
		--data '{"jsonrpc": "2.0", "id": "1", "method": "web3_clientVersion", "params": []}' \
		|| true)
	sleep 1
	echo -n .
done

echo
echo Node ready
