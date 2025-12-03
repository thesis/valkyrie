import React, { useState, useEffect } from "react"
import type { Deployment, EnvVar } from "../types"

type EnvVarViewerProps = {
  deployment: Deployment
  onClose: () => void
}

export function EnvVarViewer({
  deployment,
  onClose,
}: EnvVarViewerProps): React.ReactElement {
  const [envVars, setEnvVars] = useState<EnvVar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | "build" | "runtime">("all")

  useEffect(() => {
    fetchEnvVars()
  }, [deployment.id])

  async function fetchEnvVars() {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/env-vars/${deployment.id}`)
      const data = await res.json()

      if (data.success) {
        setEnvVars(data.data)
      } else {
        setError(data.error ?? "Failed to fetch environment variables")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data")
    } finally {
      setLoading(false)
    }
  }

  const filteredVars = envVars.filter((v) => {
    if (filter === "all") return true
    if (filter === "build") return !v.is_runtime
    if (filter === "runtime") return v.is_runtime
    return true
  })

  const buildVars = envVars.filter((v) => !v.is_runtime)
  const runtimeVars = envVars.filter((v) => v.is_runtime)

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Environment Variables</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </header>

        <div className="modal-meta">
          <dl className="meta-grid">
            <div>
              <dt>Worker</dt>
              <dd>{deployment.worker_name}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>
                <span className="env-badge">{deployment.environment}</span>
              </dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd>
                <code>{deployment.commit_sha.slice(0, 7)}</code>
              </dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>
                <code>{deployment.branch}</code>
              </dd>
            </div>
          </dl>
        </div>

        <div className="modal-body">
          {loading ? (
            <p className="loading">Loading environment variables...</p>
          ) : error ? (
            <p className="error">{error}</p>
          ) : envVars.length === 0 ? (
            <p className="empty-state">
              No environment variables recorded for this deployment.
            </p>
          ) : (
            <>
              <fieldset className="filter-controls">
                <legend className="visually-hidden">Filter variables</legend>
                <ol className="filter-options">
                  <li>
                    <button
                      type="button"
                      className={`filter-btn ${filter === "all" ? "active" : ""}`}
                      onClick={() => setFilter("all")}
                    >
                      All ({envVars.length})
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className={`filter-btn ${filter === "build" ? "active" : ""}`}
                      onClick={() => setFilter("build")}
                    >
                      Build ({buildVars.length})
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className={`filter-btn ${filter === "runtime" ? "active" : ""}`}
                      onClick={() => setFilter("runtime")}
                    >
                      Runtime ({runtimeVars.length})
                    </button>
                  </li>
                </ol>
              </fieldset>

              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Value</th>
                      <th scope="col">Type</th>
                      <th scope="col">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVars.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <code>{v.name}</code>
                          {v.is_secret && (
                            <span className="secret-badge" title="Secret">
                              🔒
                            </span>
                          )}
                        </td>
                        <td>
                          <code className="masked-value">{v.masked_value}</code>
                        </td>
                        <td>
                          <span
                            className={`type-badge ${v.is_runtime ? "type-runtime" : "type-build"}`}
                          >
                            {v.is_runtime ? "Runtime" : "Build"}
                          </span>
                        </td>
                        <td>
                          <span className="source-badge">{v.source}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
