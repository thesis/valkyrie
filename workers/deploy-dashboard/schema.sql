-- Deploy Dashboard D1 Database Schema
-- This schema tracks deployments and environment variables for the dashboard

-- Deployments table - tracks all deployments across environments
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  worker_name TEXT NOT NULL,
  environment TEXT NOT NULL,
  pr_number INTEGER,
  commit_sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  deployed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error_message TEXT,
  repository TEXT NOT NULL,

  -- Indexes for common queries
  UNIQUE(worker_name, environment, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_deployments_worker ON deployments(worker_name);
CREATE INDEX IF NOT EXISTS idx_deployments_environment ON deployments(environment);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_pr ON deployments(pr_number);
CREATE INDEX IF NOT EXISTS idx_deployments_deployed_at ON deployments(deployed_at DESC);

-- Environment variables table - stores env vars for each deployment
CREATE TABLE IF NOT EXISTS environment_variables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  masked_value TEXT NOT NULL,
  is_runtime INTEGER NOT NULL DEFAULT 0,
  is_secret INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'github',
  created_at TEXT NOT NULL,

  FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE,
  UNIQUE(deployment_id, name, is_runtime)
);

CREATE INDEX IF NOT EXISTS idx_env_vars_deployment ON environment_variables(deployment_id);
CREATE INDEX IF NOT EXISTS idx_env_vars_runtime ON environment_variables(is_runtime);

-- Preview deployments table - tracks preview subdomains
CREATE TABLE IF NOT EXISTS preview_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_number INTEGER NOT NULL UNIQUE,
  subdomain TEXT NOT NULL,
  dns_record_id TEXT,
  repository TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cleaned_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_preview_pr ON preview_deployments(pr_number);
CREATE INDEX IF NOT EXISTS idx_preview_status ON preview_deployments(status);

-- Deployment history table - audit log of all deployment events
CREATE TABLE IF NOT EXISTS deployment_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deployment_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data TEXT,
  created_at TEXT NOT NULL,

  FOREIGN KEY (deployment_id) REFERENCES deployments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_deployment ON deployment_history(deployment_id);
CREATE INDEX IF NOT EXISTS idx_history_created ON deployment_history(created_at DESC);

-- Workers table - registry of all known workers
CREATE TABLE IF NOT EXISTS workers (
  name TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  environments TEXT NOT NULL, -- JSON array
  routes TEXT NOT NULL, -- JSON object
  preview_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- API keys table - for dashboard API authentication
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '["read"]', -- JSON array
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

-- Views for common queries

-- Active deployments view
CREATE VIEW IF NOT EXISTS active_deployments AS
SELECT
  d.*,
  w.path as worker_path,
  w.routes as worker_routes
FROM deployments d
LEFT JOIN workers w ON d.worker_name = w.name
WHERE d.status IN ('deployed', 'deploying')
ORDER BY d.deployed_at DESC;

-- Preview deployments with details view
CREATE VIEW IF NOT EXISTS preview_details AS
SELECT
  p.*,
  GROUP_CONCAT(d.worker_name) as deployed_workers,
  COUNT(d.id) as worker_count
FROM preview_deployments p
LEFT JOIN deployments d ON p.pr_number = d.pr_number AND d.environment = 'preview'
WHERE p.status = 'active'
GROUP BY p.id
ORDER BY p.created_at DESC;

-- Environment variables summary view
CREATE VIEW IF NOT EXISTS env_var_summary AS
SELECT
  d.worker_name,
  d.environment,
  COUNT(CASE WHEN ev.is_runtime = 1 THEN 1 END) as runtime_vars,
  COUNT(CASE WHEN ev.is_runtime = 0 THEN 1 END) as build_vars,
  COUNT(CASE WHEN ev.is_secret = 1 THEN 1 END) as secret_vars
FROM deployments d
LEFT JOIN environment_variables ev ON d.id = ev.deployment_id
WHERE d.status = 'deployed'
GROUP BY d.worker_name, d.environment;
