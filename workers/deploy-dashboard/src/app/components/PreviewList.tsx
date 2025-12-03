import React from "react"
import type { Preview } from "../types"

type PreviewListProps = {
  previews: Preview[]
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString()
}

export function PreviewList({ previews }: PreviewListProps): React.ReactElement {
  if (previews.length === 0) {
    return (
      <section className="card">
        <h2>PR Previews</h2>
        <p className="empty-state">No preview deployments found.</p>
      </section>
    )
  }

  const activePreviews = previews.filter((p) => p.status === "active")
  const cleanedPreviews = previews.filter((p) => p.status === "cleaned")

  return (
    <section className="card">
      <h2>PR Previews</h2>

      {activePreviews.length > 0 && (
        <>
          <h3>Active Previews</h3>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">PR</th>
                  <th scope="col">Subdomain</th>
                  <th scope="col">Repository</th>
                  <th scope="col">Created</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {activePreviews.map((preview) => (
                  <tr key={preview.id}>
                    <td>
                      <span className="pr-badge">#{preview.pr_number}</span>
                    </td>
                    <td>
                      <code>{preview.subdomain}</code>
                    </td>
                    <td>{preview.repository}</td>
                    <td>{formatDate(preview.created_at)}</td>
                    <td>
                      <a
                        href={`https://${preview.subdomain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-primary btn-sm"
                      >
                        Visit
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {cleanedPreviews.length > 0 && (
        <>
          <h3>Recently Cleaned</h3>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">PR</th>
                  <th scope="col">Subdomain</th>
                  <th scope="col">Repository</th>
                  <th scope="col">Cleaned At</th>
                </tr>
              </thead>
              <tbody>
                {cleanedPreviews.slice(0, 10).map((preview) => (
                  <tr key={preview.id} className="row-muted">
                    <td>
                      <span className="pr-badge pr-badge-muted">
                        #{preview.pr_number}
                      </span>
                    </td>
                    <td>
                      <code>{preview.subdomain}</code>
                    </td>
                    <td>{preview.repository}</td>
                    <td>
                      {preview.cleaned_at
                        ? formatDate(preview.cleaned_at)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
