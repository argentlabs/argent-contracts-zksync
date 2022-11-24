#!/bin/bash

set -e # stop the script if any subprocess fails

echo XXXXX Starting the node

cd local-setup
# ./start.sh >/dev/null 2>&1 &
./start.sh >/dev/null | grep '^local-setup-zksync' &
cd ..

echo XXXXX Waiting until the node is up and running

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
echo XXXXX Node ready