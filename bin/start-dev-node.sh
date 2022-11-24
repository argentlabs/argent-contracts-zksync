#!/bin/bash

# Starts a local zkSync node for development purposes

set -e # stop the script if any subprocess fails

cd local-setup
./start.sh | grep --invert-match '^local-setup-geth'
