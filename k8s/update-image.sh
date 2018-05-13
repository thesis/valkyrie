#!/bin/sh
set -e

kubectl set image deployment/heimdall-hubot-deployment hubot=gcr.io/cfc-production/heimdall:$1