# Cloudflare Workers Deployment System

This directory contains a generic deployment system for Cloudflare Workers with GitHub Actions integration.

## Architecture Overview

```
workers/
├── _shared/                    # Shared utilities and types
│   ├── config.ts               # Worker configuration system
│   ├── env.ts                  # Environment variable management
│   └── types.ts                # Shared TypeScript types
├── _scripts/                   # Deployment scripts
│   ├── detect-changes.ts       # Detect which workers changed
│   ├── provision-subdomain.ts  # Provision PR preview subdomains
│   ├── deprovision-subdomain.ts# Clean up PR preview subdomains
│   └── sync-env.ts             # Sync environment variables
├── deploy-dashboard/           # Deployment dashboard (Next.js + D1)
│   ├── wrangler.toml
│   └── src/
└── example-worker/             # Example worker template
    ├── wrangler.toml
    └── src/
```

## Key Concepts

### 1. Environment Mapping

Each Wrangler environment maps 1:1 to a GitHub Environment:
- `production` → GitHub Environment: `production`
- `staging` → GitHub Environment: `staging`
- `preview` → Dynamically created for PRs

### 2. Environment Variable Prefix

Variables prefixed with `RUNTIME_` are synced to the deployed worker's runtime:
- `RUNTIME_API_KEY` → Available as `API_KEY` in the worker
- `RUNTIME_DATABASE_URL` → Available as `DATABASE_URL` in the worker

Variables without the prefix are build-time only.

### 3. PR Preview Environments

When a PR is opened:
1. A subdomain is provisioned: `pr-{number}.{zone}`
2. Workers are deployed to the preview environment
3. On merge/close, the subdomain is deprovisioned

### 4. Matrix Deployments

Merging to main triggers matrix builds for configured environments:
- Each environment is deployed in parallel
- Failed deployments don't block other environments

## Configuration

### workers.config.ts

```typescript
export const workersConfig: WorkersConfig = {
  zone: "example.com",
  previewSubdomain: "preview",
  runtimeEnvPrefix: "RUNTIME_",
  workers: {
    "api": {
      path: "workers/api",
      environments: ["production", "staging"],
      routes: {
        production: "api.example.com/*",
        staging: "api-staging.example.com/*",
      },
    },
    "dashboard": {
      path: "workers/deploy-dashboard",
      environments: ["production"],
      routes: {
        production: "deploy.example.com/*",
      },
    },
  },
}
```

## GitHub Actions Workflows

### PR Workflow (`.github/workflows/workers-pr.yml`)

Triggers on PR events:
1. Detects which workers changed
2. Builds only affected workers
3. Deploys to preview environment
4. Reports deployment URLs in PR comments

### Main Workflow (`.github/workflows/workers-deploy.yml`)

Triggers on merge to main:
1. Detects which workers changed
2. Matrix builds for all configured environments
3. Deploys each environment in parallel

### Cleanup Workflow (`.github/workflows/workers-cleanup.yml`)

Triggers on PR close:
1. Deprovisions preview subdomain
2. Cleans up D1 deployment records

## Dashboard

The deployment dashboard provides:
- View all active deployments
- Environment variables for each deployment (build & runtime)
- Deployment history and logs
- Protected by Cloudflare Access

## Getting Started

1. Copy `example-worker/` as a template for new workers
2. Add worker configuration to `workers.config.ts`
3. Set up GitHub Environments with required secrets
4. Configure Cloudflare API token with required permissions:
   - Zone:DNS:Edit (for subdomain provisioning)
   - Workers Scripts:Edit
   - Workers Routes:Edit
   - D1:Edit (for dashboard)

## Required GitHub Secrets

- `CLOUDFLARE_API_TOKEN`: API token with required permissions
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare account ID
- `CLOUDFLARE_ZONE_ID`: Zone ID for subdomain provisioning

## Setup Guide

### 1. Initial Setup

```bash
# Install dependencies
pnpm install

# Create the D1 database for the dashboard
wrangler d1 create deploy-dashboard-db

# Run migrations
cd workers/deploy-dashboard
pnpm db:migrate:local  # For local development
pnpm db:migrate        # For production
```

### 2. Configure workers.config.ts

Edit `workers/workers.config.ts` to match your project:

```typescript
export const workersConfig: WorkersConfig = {
  // Your domain for preview deployments
  zone: "yourdomain.com",

  // Preview URLs will be: pr-123.preview.yourdomain.com
  previewSubdomain: "preview",

  // Variables starting with this prefix sync to worker runtime
  runtimeEnvPrefix: "RUNTIME_",

  // Environments deployed on merge to main
  defaultEnvironments: ["production", "staging"],

  // Your workers
  workers: {
    "your-worker": {
      path: "workers/your-worker",
      environments: ["production", "staging"],
      routes: {
        production: "api.yourdomain.com/*",
        staging: "api-staging.yourdomain.com/*",
      },
    },
  },
}
```

### 3. Set Up GitHub Environments

Create these GitHub Environments in your repository settings:

1. **production**
   - Add protection rules (required reviewers, etc.)
   - Add secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Add `RUNTIME_` prefixed secrets for worker runtime variables

2. **staging**
   - Similar to production but with staging-specific values

3. **preview**
   - Used for PR preview deployments
   - Fewer protection rules for faster iteration

### 4. Create Cloudflare API Token

Create an API token at https://dash.cloudflare.com/profile/api-tokens with:

- **Zone:DNS:Edit** - For provisioning PR preview subdomains
- **Workers Scripts:Edit** - For deploying workers
- **Workers Routes:Edit** - For configuring routes
- **D1:Edit** - For the dashboard database (if using)

### 5. Set Up Cloudflare Access (Optional)

To protect the dashboard with Cloudflare Access:

1. Create an Access Application for your dashboard URL
2. Set up identity providers (email, SSO, etc.)
3. Add the audience tag and team domain to `wrangler.toml`

## Adding a New Worker

1. Copy the example worker:
   ```bash
   cp -r workers/example-worker workers/my-worker
   ```

2. Update configuration files in the new directory

3. Register in `workers.config.ts`:
   ```typescript
   "my-worker": {
     path: "workers/my-worker",
     environments: ["production", "staging"],
     routes: {
       production: "api.yourdomain.com/my-path/*",
       staging: "api-staging.yourdomain.com/my-path/*",
     },
   },
   ```

4. Implement your worker in `src/index.ts`

## Environment Variables

### Build-time vs Runtime

| Type | Prefix | Available At | Example |
|------|--------|--------------|---------|
| Build-time | None | GitHub Actions only | `NODE_VERSION` |
| Runtime | `RUNTIME_` | Worker execution | `RUNTIME_API_KEY` → `API_KEY` |

### Setting Variables

**In GitHub Environment secrets:**
```
CLOUDFLARE_API_TOKEN=xxx        # Build-time only
RUNTIME_DATABASE_URL=xxx        # Synced to worker as DATABASE_URL
RUNTIME_API_KEY=xxx             # Synced to worker as API_KEY
```

**In wrangler.toml:**
```toml
[env.production.vars]
ENVIRONMENT = "production"
LOG_LEVEL = "info"
```

## Local Development

```bash
# Start a worker locally
cd workers/your-worker
pnpm dev

# Run with local D1 database
wrangler dev --local --persist

# Test the dashboard locally
cd workers/deploy-dashboard
pnpm dev
```

## Deployment Flow

### PR Preview Flow

```
PR Opened/Updated
    │
    ▼
Detect Changed Workers
    │
    ▼
Provision PR Subdomain
    │
    ▼
Deploy Workers (parallel matrix)
    │
    ▼
Comment PR with URLs
```

### Main Branch Flow

```
Merge to Main
    │
    ▼
Detect Changed Workers
    │
    ▼
Matrix Deploy to Environments
    ├─ production (worker-1)
    ├─ staging (worker-1)
    ├─ production (worker-2)
    └─ staging (worker-2)
    │
    ▼
Record in Dashboard D1
```

### PR Close/Merge Flow

```
PR Closed
    │
    ▼
Deprovision DNS Record
    │
    ▼
Delete Preview Workers
    │
    ▼
Update Dashboard Records
```

## Dashboard Features

The deployment dashboard (`workers/deploy-dashboard`) provides:

- **Deployments View**: List all deployments with status, environment, and URLs
- **Preview View**: Active PR previews with quick access links
- **Workers View**: Registry of all configured workers
- **Environment Variables**: View build and runtime variables per deployment
- **Comparison**: Compare env vars between deployments

Access it at your configured dashboard URL (protected by Cloudflare Access).

## Troubleshooting

### Deployment Fails

1. Check GitHub Actions logs for errors
2. Verify Cloudflare API token permissions
3. Ensure wrangler.toml syntax is correct
4. Check that routes don't conflict with existing workers

### Preview Not Working

1. Verify DNS propagation: `dig pr-123.preview.yourdomain.com`
2. Check that CLOUDFLARE_ZONE_ID is correct
3. Ensure the zone allows DNS edits via API

### Environment Variables Not Available

1. Check the `RUNTIME_` prefix is correct
2. Verify GitHub Environment secrets are set
3. Check workflow has `environment:` specified
4. Review sync-env.ts output in GitHub Actions logs

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `detect-changes.ts` | Determine which workers changed |
| `provision-subdomain.ts` | Create DNS for PR preview |
| `deprovision-subdomain.ts` | Remove DNS on PR close |
| `sync-env.ts` | Sync RUNTIME_ vars to worker |
| `deploy-worker.ts` | Deploy single worker to environment |
