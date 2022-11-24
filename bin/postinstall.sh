#!/bin/bash

set -e # stop the script if any subprocess fails

if [ ! -d "local-setup" ]; then 
	git clone https://github.com/matter-labs/local-setup
else
	cd local-setup
	git pull > /dev/null
	docker-compose pull
fi
