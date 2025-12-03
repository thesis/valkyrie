/**
 * Type definitions for the Deploy Dashboard Worker
 */

import { z } from "zod"

/**
 * Cloudflare Worker environment bindings
 */
export type Env = {
  DB: D1Database
  ASSETS: Fetcher
  ENVIRONMENT: string
  CF_ACCESS_TEAM_DOMAIN?: string
  CF_ACCESS_AUD?: string
  API_KEY_HASH?: string
}

/**
 * Deployment status enum
 */
export const DeploymentStatus = z.enum([
  "pending",
  "deploying",
  "deployed",
  "failed",
  "deprovisioned",
])
export type DeploymentStatus = z.infer<typeof DeploymentStatus>

/**
 * Environment variable source enum
 */
export const EnvVarSource = z.enum(["github", "wrangler", "manual"])
export type EnvVarSource = z.infer<typeof EnvVarSource>

/**
 * Deployment record from D1
 */
export const DeploymentRecord = z.object({
  id: z.string(),
  worker_name: z.string(),
  environment: z.string(),
  pr_number: z.number().nullable(),
  commit_sha: z.string(),
  branch: z.string(),
  url: z.string().nullable(),
  status: DeploymentStatus,
  deployed_at: z.string(),
  updated_at: z.string(),
  error_message: z.string().nullable(),
  repository: z.string(),
})
export type DeploymentRecord = z.infer<typeof DeploymentRecord>

/**
 * Environment variable record from D1
 */
export const EnvVarRecord = z.object({
  id: z.number(),
  deployment_id: z.string(),
  name: z.string(),
  masked_value: z.string(),
  is_runtime: z.number().transform((v) => v === 1),
  is_secret: z.number().transform((v) => v === 1),
  source: EnvVarSource,
  created_at: z.string(),
})
export type EnvVarRecord = z.infer<typeof EnvVarRecord>

/**
 * Preview deployment record from D1
 */
export const PreviewRecord = z.object({
  id: z.number(),
  pr_number: z.number(),
  subdomain: z.string(),
  dns_record_id: z.string().nullable(),
  repository: z.string(),
  created_at: z.string(),
  cleaned_at: z.string().nullable(),
  status: z.enum(["active", "cleaned"]),
})
export type PreviewRecord = z.infer<typeof PreviewRecord>

/**
 * Worker record from D1
 */
export const WorkerRecord = z.object({
  name: z.string(),
  path: z.string(),
  environments: z.string().transform((v) => JSON.parse(v) as string[]),
  routes: z.string().transform((v) => JSON.parse(v) as Record<string, string>),
  preview_enabled: z.number().transform((v) => v === 1),
  created_at: z.string(),
  updated_at: z.string(),
})
export type WorkerRecord = z.infer<typeof WorkerRecord>

/**
 * API request schemas
 */

export const CreateDeploymentRequest = z.object({
  worker: z.string(),
  environment: z.string(),
  url: z.string().optional(),
  deploymentId: z.string(),
  commitSha: z.string(),
  branch: z.string(),
  repository: z.string(),
  prNumber: z.number().optional(),
  deployedAt: z.string(),
})
export type CreateDeploymentRequest = z.infer<typeof CreateDeploymentRequest>

export const UpdateDeploymentRequest = z.object({
  status: DeploymentStatus.optional(),
  url: z.string().optional(),
  errorMessage: z.string().optional(),
})
export type UpdateDeploymentRequest = z.infer<typeof UpdateDeploymentRequest>

export const CreateEnvVarsRequest = z.object({
  deploymentId: z.string(),
  variables: z.array(
    z.object({
      name: z.string(),
      maskedValue: z.string(),
      isRuntime: z.boolean(),
      isSecret: z.boolean(),
      source: EnvVarSource.optional().default("github"),
    }),
  ),
})
export type CreateEnvVarsRequest = z.infer<typeof CreateEnvVarsRequest>

export const CreatePreviewRequest = z.object({
  prNumber: z.number(),
  subdomain: z.string(),
  dnsRecordId: z.string().optional(),
  repository: z.string(),
})
export type CreatePreviewRequest = z.infer<typeof CreatePreviewRequest>

export const CleanupPreviewRequest = z.object({
  prNumber: z.number(),
  repository: z.string(),
  merged: z.boolean(),
  cleanedAt: z.string(),
})
export type CleanupPreviewRequest = z.infer<typeof CleanupPreviewRequest>

export const RegisterWorkerRequest = z.object({
  name: z.string(),
  path: z.string(),
  environments: z.array(z.string()),
  routes: z.record(z.string()),
  previewEnabled: z.boolean().optional().default(true),
})
export type RegisterWorkerRequest = z.infer<typeof RegisterWorkerRequest>

/**
 * API response types
 */

export type ApiResponse<T> = {
  success: boolean
  data?: T
  error?: string
}

export type PaginatedResponse<T> = ApiResponse<{
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}>
