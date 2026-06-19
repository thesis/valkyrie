#!/bin/sh
set -e

kubectl apply --record -f "${BASH_SOURCE%/*}/valkyrie-redis-stateful-set.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/valkyrie-redis-service.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/valkyrie-hubot-deployment.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/valkyrie-http-service.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/valkyrie-web-ingress.yaml"
