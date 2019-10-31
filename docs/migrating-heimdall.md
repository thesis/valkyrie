# MIGRATING HEIMDALL TO A NEW GCP PROJECT

This document contains instructions for our migration of Heimdall from the
`cfc-production-deprecated` project to `thesis-ops`. It attempts to provide
this information in a sufficiently generalized way, so that it will remain a
useful reference point for any future migrations.

## Table of Contents:

- [Migration Scope](#migration-scope)
- [Set up your access](#set-up-your-access)
- [Migrating Secrets](#migrating-secrets)
- [Migrating Redis-brain](#migrating-redis-brain)

## Migration Scope

- Source GCP Project: `cfc-production-deprecated`
- Target GCP Project: `thesis-ops`
- Source Cluster: `gke_cfc-production_us-east4-c_heimdall`
- Target Cluser: `gke_thesis-ops-2748_us-central1_heimdall` (not yet created)

### Kube Objects

- Secret Data: `heimdall-hubot`
- StatefulSet Data: `heimdall-redis-set`

## Set up your access

Make sure you have been granted access to the new project. This should be
done via terraform, with an update to the iam role.

Set up your vpn to access the project (get an `.ovpn` config file from the project owner).

Use glcoud to download the kubectl profile for the cluster:

Using `gcloud beta interactive` is helpful; it opens a console with
autocomplete for gcloud commands. The command to download the kubectl profile
is `gcloud container clusters get-credentials` -- you must specify the
`<project-name>`, set the `--internal-ip` flag, and `--region <your-region>`

In our case:
`gcloud container clusters get-credentials thesis-ops --internal-ip --region us-central1`

You should now be able to see `gke_thesis-ops-2748_us-central1_thesis-ops`.
Verify this via: `kubectl get context`.

## Migrating Secrets

All of Heimdall's secrets are stored in one GCP `Secret` object, named
`heimdall-hubot`, which is in the `default` namespace.

You can view the details via:
`kubectl describe secret heimdall-hubot`

You will not be able to view the values this way, but you can see the key names
and of all currently-stored secrets, and the size of each value.

Copying secrets from one project to another can be done with the following
kubectl commands:
`kubectl get secret my-secret-name --export -o yaml > my-secret-name.yaml`

Switch your kubectl context to the new project:
`kubectl config use-context gke_thesis-ops-2748_us-central1_thesis-ops`

Open your VPN connection. You should now be able to apply the secrets:
`kubectl apply -f my-secret-name.yaml`

Verify that the secrets copied, and look like you expect, by viewing the
details, and comparing against the details viewed before exporting. Run the
same command you ran earlier (but from the current context):
`kubectl describe secret heimdall-hubot`

Note: If you're using kubectl version 1.18 or greater, `--export` will no longer
be available. You can still save the secrets with `-o yaml` but you will have
some extra data in the file.

## Migrating Redis-brain

Make sure your `kubectl` context is set back to the old project:
`kubectl config use-context gke_cfc-production_us-east4-c_heimdall`

Then exec into the redis pod:
`kubectl exec -it heimdall-redis-set-0 sh`

Verify that the database file is where we expect it to be:
`ls /redis-master-data/dump.rdb`

Save the current state of the database, to ensure you have an up-to-date dump file:

```
/data # redis-cli
127.0.0.1:6379> save
OK
127.0.0.1:6379> exit
```

Make a copy of the dumpfile:
`cp /redis-master-data/dump.rdb ./redis-brain-backup-2019-10-31.rdb`
(substituting filenames and paths as appropriate)
Then exit the kubectl shell.

Make a copy of the backup file to your local filesystem:
`kubectl cp heimdall-redis-set-0:/data/redis-brain-backup-2019-10-31.rdb ./redis-brain-backup-2019-10-31.rdb`

Change kubectl context to your new project, and open your VPN connection.

The following steps can not be done until the redis cluster has been created in
the new project. You can verify that it exists by running `kubectl get pods`
from within the kube context for the new project, you should see
`heimdall-redis-set-0`. If the redis brain cluster has been renamed, replace
`heimdall-redis-set-0` in the below commands with your pod name.

Copy the backup file to your new pod:
`kubectl cp ./redis-brain-backup-2019-10-31.rdb heimdall-redis-set-0:/data/redis-brain-backup-2019-10-31.rdb`

Exec into the running redis pod in the new context:
`kubectl exec -it heimdall-redis-set-0 sh`

Verfiy that your new redis server is up and running:
`redis-benchmark -q -n 1000 -c 10 -P 5`

And then stop it:
`service redis-server stop`
Verify that it's stopped:
`service redis-server status` (Should output `redis-server is not running`)

Make a copy of they new project's dump file, just in case you need to roll back:
`pc /redis-master-data/dump.rdb /redis-master-data/dump.rdb.old`

Copy and rename your old project's db backup to replace the current dump file:
`cp -p ./redis-brain-backup-2019-10-31.rdb /redis-master-data/dump.rdb`

Look at the new data file's permissions and modify as needed:
`chown root:root /redis-master-data/dump.rdb`

You can now restart the redis service:
`service redis-server start`
