/**
 * Shared types for the Cloudflare Workers deployment system.
 */

/**
 * Configuration for a single worker.
 */
export type WorkerConfig = {
  /** Relative path to the worker directory from repository root */
  path: string
  /** List of environments this worker deploys to */
  environments: string[]
  /** Route patterns for each environment */
  routes: Record<string, string>
  /** Optional custom build command (defaults to wrangler deploy) */
  buildCommand?: string
  /** Optional D1 database bindings */
  d1Databases?: Record<string, string>
  /** Optional KV namespace bindings */
  kvNamespaces?: Record<string, string>
  /** Whether this worker is enabled for preview deployments */
  previewEnabled?: boolean
}

/**
 * Root configuration for all workers in the project.
 */
export type WorkersConfig = {
  /** The DNS zone for preview subdomains */
  zone: string
  /** Subdomain prefix for preview deployments (e.g., "preview" -> pr-123.preview.example.com) */
  previewSubdomain: string
  /** Prefix for environment variables that should sync to runtime */
  runtimeEnvPrefix: string
  /** Map of worker names to their configurations */
  workers: Record<string, WorkerConfig>
  /** Default environments for matrix deployments */
  defaultEnvironments: string[]
  /** Cloudflare Access configuration for protected workers */
  accessConfig?: AccessConfig
}

/**
 * Cloudflare Access configuration.
 */
export type AccessConfig = {
  /** Access application audience tag */
  audience: string
  /** Team domain for access policies */
  teamDomain: string
  /** Allowed email domains */
  allowedDomains: string[]
}

/**
 * Environment variable with metadata.
 */
export type EnvVariable = {
  /** Variable name (without prefix) */
  name: string
  /** Variable value */
  value: string
  /** Whether this is a runtime variable (vs build-time only) */
  isRuntime: boolean
  /** Whether this is a secret (should be masked) */
  isSecret: boolean
  /** Source of the variable (github, wrangler, manual) */
  source: "github" | "wrangler" | "manual"
}

/**
 * Deployment record stored in D1.
 */
export type DeploymentRecord = {
  /** Unique deployment ID */
  id: string
  /** Worker name */
  workerName: string
  /** Environment (production, staging, preview) */
  environment: string
  /** PR number for preview deployments */
  prNumber?: number
  /** Git commit SHA */
  commitSha: string
  /** Git branch name */
  branch: string
  /** Deployment URL */
  url: string
  /** Deployment status */
  status: "pending" | "deploying" | "deployed" | "failed" | "deprovisioned"
  /** Build-time environment variables */
  buildEnv: EnvVariable[]
  /** Runtime environment variables */
  runtimeEnv: EnvVariable[]
  /** Deployment timestamp */
  deployedAt: string
  /** Last updated timestamp */
  updatedAt: string
  /** Error message if deployment failed */
  errorMessage?: string
}

/**
 * PR preview deployment info.
 */
export type PreviewDeployment = {
  /** PR number */
  prNumber: number
  /** Subdomain provisioned */
  subdomain: string
  /** DNS record ID for cleanup */
  dnsRecordId: string
  /** Workers deployed in this preview */
  workers: string[]
  /** Deployment URLs */
  urls: Record<string, string>
  /** Creation timestamp */
  createdAt: string
}

/**
 * Result of change detection.
 */
export type ChangeDetectionResult = {
  /** Workers that have changes */
  changedWorkers: string[]
  /** Whether shared code changed (affects all workers) */
  sharedChanged: boolean
  /** Files that changed */
  changedFiles: string[]
}

/**
 * GitHub Actions matrix output format.
 */
export type MatrixOutput = {
  include: Array<{
    worker: string
    environment: string
    path: string
  }>
}

/**
 * Wrangler environment configuration.
 */
export type WranglerEnvConfig = {
  name: string
  route?: string
  routes?: string[]
  vars?: Record<string, string>
  kv_namespaces?: Array<{
    binding: string
    id: string
    preview_id?: string
  }>
  d1_databases?: Array<{
    binding: string
    database_name: string
    database_id: string
  }>
}

/**
 * Wrangler.toml configuration structure.
 */
export type WranglerConfig = {
  name: string
  main: string
  compatibility_date: string
  compatibility_flags?: string[]
  account_id?: string
  workers_dev?: boolean
  route?: string
  routes?: string[]
  vars?: Record<string, string>
  kv_namespaces?: Array<{
    binding: string
    id: string
    preview_id?: string
  }>
  d1_databases?: Array<{
    binding: string
    database_name: string
    database_id: string
  }>
  env?: Record<string, WranglerEnvConfig>
}
