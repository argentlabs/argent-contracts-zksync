#!/bin/bash

# Starts a local zkSync node for development purposes

set -e # stop the script if any subprocess fails

cd local-setup
./start.sh 2>&1 | grep --invert-match 'local-setup-geth-1'
