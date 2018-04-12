#!/bin/sh
kubectl apply --record -f "${BASH_SOURCE%/*}/redis-deployment.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/redis-service.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/hubot-deployment.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/hubot-http-service.yaml"
kubectl apply --record -f "${BASH_SOURCE%/*}/hubot-ingress.yaml"
