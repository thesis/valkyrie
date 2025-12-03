import React from "react"
import type { Deployment } from "../types"

type DeploymentListProps = {
  deployments: Deployment[]
  onSelect: (deployment: Deployment) => void
}

function getStatusBadgeClass(status: Deployment["status"]): string {
  const baseClass = "status-badge"
  switch (status) {
    case "deployed":
      return `${baseClass} status-deployed`
    case "deploying":
      return `${baseClass} status-deploying`
    case "pending":
      return `${baseClass} status-pending`
    case "failed":
      return `${baseClass} status-failed`
    case "deprovisioned":
      return `${baseClass} status-deprovisioned`
    default:
      return baseClass
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString()
}

function shortenSha(sha: string): string {
  return sha.slice(0, 7)
}

export function DeploymentList({
  deployments,
  onSelect,
}: DeploymentListProps): React.ReactElement {
  if (deployments.length === 0) {
    return (
      <section className="card">
        <h2>Deployments</h2>
        <p className="empty-state">No deployments found.</p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Deployments</h2>
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Worker</th>
              <th scope="col">Environment</th>
              <th scope="col">Status</th>
              <th scope="col">Branch</th>
              <th scope="col">Commit</th>
              <th scope="col">Deployed At</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((deployment) => (
              <tr key={deployment.id}>
                <td>
                  <strong>{deployment.worker_name}</strong>
                  {deployment.pr_number && (
                    <span className="pr-badge">PR #{deployment.pr_number}</span>
                  )}
                </td>
                <td>
                  <span className="env-badge">{deployment.environment}</span>
                </td>
                <td>
                  <span className={getStatusBadgeClass(deployment.status)}>
                    {deployment.status}
                  </span>
                </td>
                <td>
                  <code>{deployment.branch}</code>
                </td>
                <td>
                  <code>{shortenSha(deployment.commit_sha)}</code>
                </td>
                <td>{formatDate(deployment.deployed_at)}</td>
                <td>
                  <div className="action-buttons">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onSelect(deployment)}
                    >
                      View Env Vars
                    </button>
                    {deployment.url && (
                      <a
                        href={deployment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary btn-sm"
                      >
                        Visit
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
