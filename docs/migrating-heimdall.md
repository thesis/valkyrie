# MIGRATING HEIMDALL TO A NEW GCP PROJECT

## Set up your access

## Migrating Secrets

All of Heimdall's secrets are stored in one GCP `Secret` object, named
`heimdall-hubot`, which is in the `default` namespace.

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

Make sure you have been granted access to the new project. This should be
done via terraform, with an update to the iam role.

Set up your vpn to access the project (get an `.ovpn` config file from the project owner).

Use glcoud to download the kubectl profile for the cluster:

- `gcloud beta interactive` opens a console with autocomplete for gcloud commands
- `gcloud container clusters get-credentials <project-name> --internal-ip --region <your-region>`

Switch your kubectl context to the new project

- Verify that you see it in `kubectl get context`
- `kubectl config use-context <your-context>`

You should now be able to apply the secrets as described [above](#migrating-secrets).

## Migrating Redis-brain

Make sure your `kubectl` context is set to the old project, and exec into the
redis pod:
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
`cp /redis-master-data/dump.rdb ./<your-backup-name>.rdb`
then exit the kubectl shell.

Make a copy of the backup file to your local filesystem:
`kubectl cp heimdall-redis-set-0:/data/<your-backup-name>.rdb ./<your-backup-name>.rdb`

Change kubectl context to your new project, and open your VPN connection.

Copy the backup file to your new pod:
`kubectl cp ./<your-backup-name>.rdb <new-redis-pod>:/data/<your-backup-name>.rdb`

Exec into the running redis pod in the new context:
`kubectl exec -it <new-redis-pod> sh`

Verfiy that your new redis server is up and running:
`redis-benchmark -q -n 1000 -c 10 -P 5`

And then stop it:
`service redis-server stop`
Verify that it's stopped:
`service redis-server status` (Should output `redis-server is not running`)

Make a copy of they new project's dump file, just in case you need to roll back:
`pc /redis-master-data/dump.rdb /redis-master-data/dump.rdb.old`

Copy and rename your old project's db backup to replace the current dump file:
`cp -p ./<your-backup-name>.rdb /redis-master-data/dump.rdb`

Look at the new data file's has permissions and modify as needed:
`ls -ls /redis-master-data/`

Example:

```
-rw-r--r--    1 501      dialout      10842 Oct 28 21:34 dump.rdb
-rw-r--r--    1 root     root         10842 Oct 28 21:30 dump.rdb.old
```

The file copied from the local filesystem, above, shows `501:dialout`.
Update it:
`chown root:root /redis-master-data/dump.rdb`

In this case we don't need to `chmod` - but you should confirm that for your db copy.

You can now restart the redis service:
`service redis-server start`
