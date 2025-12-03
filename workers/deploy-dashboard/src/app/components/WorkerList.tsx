import React from "react"
import type { Worker } from "../types"

type WorkerListProps = {
  workers: Worker[]
}

export function WorkerList({ workers }: WorkerListProps): React.ReactElement {
  if (workers.length === 0) {
    return (
      <section className="card">
        <h2>Registered Workers</h2>
        <p className="empty-state">No workers registered yet.</p>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Registered Workers</h2>
      <ul className="worker-grid">
        {workers.map((worker) => (
          <li key={worker.name} className="worker-card">
            <header className="worker-card-header">
              <h3>{worker.name}</h3>
              {worker.previewEnabled ? (
                <span className="badge badge-success">Preview Enabled</span>
              ) : (
                <span className="badge badge-muted">No Preview</span>
              )}
            </header>

            <dl className="worker-details">
              <div className="detail-row">
                <dt>Path</dt>
                <dd>
                  <code>{worker.path}</code>
                </dd>
              </div>

              <div className="detail-row">
                <dt>Environments</dt>
                <dd>
                  <ul className="env-list">
                    {worker.environments.map((env) => (
                      <li key={env}>
                        <span className="env-badge">{env}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>

              <div className="detail-row">
                <dt>Routes</dt>
                <dd>
                  <ul className="route-list">
                    {Object.entries(worker.routes).map(([env, route]) => (
                      <li key={env}>
                        <span className="env-badge-sm">{env}</span>
                        <code>{route}</code>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  )
}
