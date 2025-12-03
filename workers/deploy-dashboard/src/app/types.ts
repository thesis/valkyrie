/**
 * Frontend type definitions for the Deploy Dashboard
 */

export type Deployment = {
  id: string
  worker_name: string
  environment: string
  pr_number: number | null
  commit_sha: string
  branch: string
  url: string | null
  status: "pending" | "deploying" | "deployed" | "failed" | "deprovisioned"
  deployed_at: string
  updated_at: string
  error_message: string | null
  repository: string
}

export type EnvVar = {
  id: number
  deployment_id: string
  name: string
  masked_value: string
  is_runtime: boolean
  is_secret: boolean
  source: "github" | "wrangler" | "manual"
  created_at: string
}

export type Preview = {
  id: number
  pr_number: number
  subdomain: string
  dns_record_id: string | null
  repository: string
  created_at: string
  cleaned_at: string | null
  status: "active" | "cleaned"
}

export type Worker = {
  name: string
  path: string
  environments: string[]
  routes: Record<string, string>
  previewEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type ApiResponse<T> = {
  success: boolean
  data?: T
  error?: string
}

export type PaginatedData<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}
