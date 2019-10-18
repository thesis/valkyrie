#!/bin/sh
set -e

kubectl apply --record -f "${BASH_SOURCE%/*}/heimdall-redis-stateful-set.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/heimdall-redis-service.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/heimdall-hubot-deployment.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/heimdall-http-service.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/heimdall-web-ingress.yaml"
