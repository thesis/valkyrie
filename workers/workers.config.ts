/**
 * Workers deployment configuration.
 *
 * This file defines all Cloudflare Workers in the project and their
 * deployment settings. Each worker maps to a subdirectory in the workers/ folder.
 */

import type { WorkersConfig } from "./_shared/types.ts"

/**
 * Main workers configuration for this project.
 *
 * To add a new worker:
 * 1. Create a directory under workers/ with your worker code
 * 2. Add a wrangler.toml in that directory
 * 3. Add an entry to the workers object below
 */
export const workersConfig: WorkersConfig = {
  // The DNS zone for preview subdomains (customize for your project)
  zone: "example.com",

  // Preview deployments will be at: pr-{number}.preview.example.com
  previewSubdomain: "preview",

  // Environment variables prefixed with this will sync to worker runtime
  // e.g., RUNTIME_API_KEY -> API_KEY in the worker
  runtimeEnvPrefix: "RUNTIME_",

  // Default environments for matrix deployments on main branch
  defaultEnvironments: ["production", "staging"],

  // Worker configurations
  workers: {
    // Deployment dashboard - tracks all deployments and env vars
    "deploy-dashboard": {
      path: "workers/deploy-dashboard",
      environments: ["production"],
      routes: {
        production: "deploy.example.com/*",
      },
      d1Databases: {
        DB: "deploy-dashboard-db",
      },
      // Dashboard is always deployed, even in previews
      previewEnabled: true,
    },

    // Example worker - template for new workers
    "example-worker": {
      path: "workers/example-worker",
      environments: ["production", "staging"],
      routes: {
        production: "api.example.com/example/*",
        staging: "api-staging.example.com/example/*",
      },
      previewEnabled: true,
    },
  },

  // Cloudflare Access configuration for protected workers
  accessConfig: {
    // Your Access application audience tag (from Cloudflare dashboard)
    audience: "",
    // Your team's Access domain (e.g., myteam.cloudflareaccess.com)
    teamDomain: "",
    // Email domains allowed to access protected workers
    allowedDomains: ["example.com"],
  },
}

export default workersConfig
