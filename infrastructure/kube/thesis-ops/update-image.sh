#!/bin/sh
set -e

kubectl set image deployment/heimdall-hubot-deployment hubot=gcr.io/thesis-ops-2748/heimdall:$1
