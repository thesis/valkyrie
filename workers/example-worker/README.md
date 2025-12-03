# Example Worker

This is a template Cloudflare Worker demonstrating the patterns and structure used in this deployment system.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start local development
pnpm dev

# Deploy to staging
pnpm deploy:staging

# Deploy to production
pnpm deploy:production
```

## Structure

```
example-worker/
├── src/
│   └── index.ts      # Main worker entry point
├── wrangler.toml     # Cloudflare configuration
├── package.json      # Dependencies and scripts
├── tsconfig.json     # TypeScript configuration
└── README.md         # This file
```

## Environment Variables

### Build-time Variables

These are available during build but not at runtime:
- Set in GitHub Environment secrets without the `RUNTIME_` prefix

### Runtime Variables

These are synced to the deployed worker:
- Set in GitHub Environment secrets with the `RUNTIME_` prefix
- The prefix is stripped when synced (e.g., `RUNTIME_API_KEY` → `API_KEY`)

### Wrangler Variables

Defined directly in `wrangler.toml`:
- `ENVIRONMENT`: Current deployment environment
- `LOG_LEVEL`: Logging verbosity

## Creating a New Worker

1. Copy this directory:
   ```bash
   cp -r workers/example-worker workers/my-new-worker
   ```

2. Update `wrangler.toml`:
   - Change `name` to your worker name
   - Configure routes for each environment
   - Add any required bindings (KV, D1, etc.)

3. Update `package.json`:
   - Change `name` to match your worker

4. Register in `workers/workers.config.ts`:
   ```typescript
   workers: {
     "my-new-worker": {
       path: "workers/my-new-worker",
       environments: ["production", "staging"],
       routes: {
         production: "api.example.com/my-path/*",
         staging: "api-staging.example.com/my-path/*",
       },
       previewEnabled: true,
     },
   }
   ```

5. Implement your worker logic in `src/index.ts`

## API Endpoints

### GET /health
Health check endpoint for monitoring.

### GET /
Returns worker information.

### GET /echo?message=Hello
Echoes back the provided message.

### POST /items
Creates a new item (example of POST with validation).

### GET /config
Shows configuration (hidden in production).

## Best Practices

1. **Use Hono** for routing - it's fast and works great on Workers
2. **Validate requests** with Zod before processing
3. **Structure logging** with tslog for observability
4. **Handle errors** gracefully and don't leak details in production
5. **Use environment variables** for configuration - never hardcode secrets
6. **Keep workers focused** - one worker per concern
