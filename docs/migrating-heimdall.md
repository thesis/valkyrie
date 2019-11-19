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
- [Docker Image Migration Testing](#docker-image-migration-testing)

## Migration Scope

- Source GCP Project: `cfc-production-deprecated`
- Target GCP Project: `thesis-ops`
- Source Cluster: `gke_cfc-production_us-east4-c_heimdall`
- Target Cluser: `gke_thesis-ops-2748_us-central1_thesis-ops`

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
`kubectl get secret heimdall-hubot --export -o yaml > heimdall-secrets-backup-2019-10-31.yaml`

Switch your kubectl context to the new project:
`kubectl config use-context gke_thesis-ops-2748_us-central1_thesis-ops`

Open your VPN connection. You should now be able to apply the secrets:
`kubectl apply -f heimdall-secrets-backup-2019-10-31.yaml`

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

## Docker Image Migration Testing

Our production image is built by a circle workflow run for any branch pushed to
github. The image is pushed, and the deployment applied, in a workflow only run
on merges to master.

In order to do a test run of the image migration without a merge to master, we
had to bypass circle, and replicate these steps manually via command line.

We first ran the image locally, without the actual secrets, just to verify that
the build worked as expected. We then updated the build to run as Valkyrie
instead of Heimdall, pushed to the Google Cloud, and deployed.

### Building and running a test image locally

First, we baked an image on local, and pushed it manually to the `thesis-ops`
container registry.

We initally built an image with an abbreviated Entrypoint in
[the Dockerfile](../infrastructure/docker/Dockerfile). We removed the `adapter`
flag to prevent Heimdall from connecting to Flowdock:

```
- ENTRYPOINT ["bin/hubot", "--name", "heimdall", "--adapter", "reload-flowdock"]
+ ENTRYPOINT ["bin/hubot", "--name", "heimdall"]
```

We wanted to startup Heimdall in thesis-ops without enabling Flowdock, just to
see if it would boot.

With this Dockerfile edit in place, we built an image
`docker build -t heimdall-no-flowdock`
On attempting to run it locally, we got a number of errors about missing
environment variables, so we re-ran it with temporary placeholder values for the
required keys.

```
docker run --env HUBOT_FLOWDOCK_API_TOKEN="fooooo" --env GITHUB_CLIENT_ID="blahblah" --env GITHUB_CLIENT_SECRET="barrr" --env HUBOT_HOST="local" -dt heimdall-no-flowdock
```

### Pushing the test image build to GCP and

Make sure you are connected to the `thesis-ops` VPN. While this is not strictly
necessary for this step, it is good practice in general.

Ensure that you [have permission to push to this container registry](https://cloud.google.com/sdk/gcloud/reference/auth/configure-docker).

Create a new tag of the image, to use the naming convention required by GCP:

`docker tag heimdall-no-flowdock gcr.io/thesis-ops-2748/heimdall-no-flowdock-for-testing`

The name _must_ match the `[HOSTNAME]/[PROJECT-ID]/[IMAGE]` pattern in order to
push successfully to the GCP project's container registry.

Push this image:

`docker push gcr.io/thesis-ops-2748/heimdall-no-flowdock-for-testing`

### Deploying the test image

We wanted to test the new build with the Flowdock adpater, but with minimal
confusion to Flowdock users, so we decided to run hubot as our test bot
Valkyrie instead of our live bot Heimdall.

To do this without having to re-build the image, we temporarily updated the
container spec in [the deployment file](../infrastructure/kube/thesis-ops/heimdall-hubot-deployment.yaml)
to add a run command that will override the Dockerfile's entrypoint:

```
command: ["bin/valkyrie", "-a", "reload-flowdock"]
```

We also updated the image name in the same spec, to use the correct path for
our GCP `thesis-ops` project's container registry, and to use our custom-named
image (instead of an image tagged with a Circle CI build number).

```
- image: gcr.io/cfc-production/heimdall:USE_CIRCLE_CI_BUILDS
+ image: gcr.io/thesis-ops-2748/heimdall-no-flowdock-for-testing
```

Note that, while the `no-flowdock` tag is no longer accurate (because, in this
case, we _are_ now using the flowdock adpater via the updated run command),
the image name at this point is not really important. The name in the
deployment just needs match the name of the pushed build that you want to
deploy.

Now we can begin to spin up the services and deployments we want to test.

We're essentially manually running (some of) the `kubectl` commands that are
specified in the [create file](../infrastructure/kube/thesis-ops/create.sh)

```
kubectl apply --record -f "infrastructure/kube/thesis-ops/heimdall-redis-stateful-set.yaml"
kubectl apply --record -f "infrastructure/kube/thesis-ops/heimdall-redis-service.yaml"
kubectl apply --record -f "infrastructure/kube/thesis-ops/heimdall-hubot-deployment.yaml"
```

Normally, we want to be careful to spin up the deployment before the service as
a safety measure to isolate the deployment from any public access. For our test,
we only need the redis stateful set and service, which can be spun up in any
order, and the Heimdall deployment.
