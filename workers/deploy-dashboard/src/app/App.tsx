import React, { useState, useEffect } from "react"
import { DeploymentList } from "./components/DeploymentList"
import { PreviewList } from "./components/PreviewList"
import { WorkerList } from "./components/WorkerList"
import { EnvVarViewer } from "./components/EnvVarViewer"
import type { Deployment, Preview, Worker } from "./types"

type Tab = "deployments" | "previews" | "workers"

function App(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<Tab>("deployments")
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [previews, setPreviews] = useState<Preview[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [activeTab])

  async function fetchData() {
    setLoading(true)
    setError(null)

    try {
      switch (activeTab) {
        case "deployments": {
          const res = await fetch("/api/deployments?pageSize=50")
          const data = await res.json()
          if (data.success) {
            setDeployments(data.data.items)
          }
          break
        }
        case "previews": {
          const res = await fetch("/api/previews?pageSize=50")
          const data = await res.json()
          if (data.success) {
            setPreviews(data.data.items)
          }
          break
        }
        case "workers": {
          const res = await fetch("/api/workers")
          const data = await res.json()
          if (data.success) {
            setWorkers(data.data)
          }
          break
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data")
    } finally {
      setLoading(false)
    }
  }

  function handleDeploymentSelect(deployment: Deployment) {
    setSelectedDeployment(deployment)
  }

  function handleCloseEnvViewer() {
    setSelectedDeployment(null)
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="header-title">Deploy Dashboard</h1>
        <p className="header-subtitle">Cloudflare Workers Deployment Management</p>
      </header>

      <nav className="nav">
        <ul className="nav-tabs">
          <li>
            <button
              type="button"
              className={`nav-tab ${activeTab === "deployments" ? "active" : ""}`}
              onClick={() => setActiveTab("deployments")}
            >
              Deployments
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`nav-tab ${activeTab === "previews" ? "active" : ""}`}
              onClick={() => setActiveTab("previews")}
            >
              PR Previews
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`nav-tab ${activeTab === "workers" ? "active" : ""}`}
              onClick={() => setActiveTab("workers")}
            >
              Workers
            </button>
          </li>
        </ul>
      </nav>

      <main className="main">
        {error && (
          <div className="error-banner" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div className="loading">
            <p>Loading...</p>
          </div>
        ) : (
          <>
            {activeTab === "deployments" && (
              <DeploymentList
                deployments={deployments}
                onSelect={handleDeploymentSelect}
              />
            )}
            {activeTab === "previews" && <PreviewList previews={previews} />}
            {activeTab === "workers" && <WorkerList workers={workers} />}
          </>
        )}

        {selectedDeployment && (
          <EnvVarViewer
            deployment={selectedDeployment}
            onClose={handleCloseEnvViewer}
          />
        )}
      </main>

      <footer className="footer">
        <p>
          Powered by Cloudflare Workers + D1
        </p>
      </footer>
    </div>
  )
}

export default App
