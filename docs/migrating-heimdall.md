# MIGRATING HEIMDALL TO A NEW GCP PROJECT

## Set up your access

## Secrets

All of Heimdall's secrets are stored in one GCP `Secret` object, named
`heimdall-hubot`, which is in the default namespace.

You can view the details in the GCP console from the Kubernetes Configuration
tab. You will not be able to view the values in the console, but you can see
the key names of all currently-stored secrets.

Copying secrets from one project to another can be done with the following
kubectl commands:
`kubectl get secret my-secret-name --export -o yaml > my-secret-name.yaml`

Change kube context to the new project (see below for details), and:
`kubectl apply -f my-secret-name.yaml`

Note: If you're using kubectl version 1.18 or greater, `--export` will no longer
be available. You can still save the secrets with `-o yaml` but you will have
some extra data in the file.

## Switching projects and setting up config

## Redis-brain
