declare module "github-api" {
  class GitHubApi {
    constructor(params: { token: string })
    getUser(): { getProfile(): Promise<{ data: Record<string, string> }> }
    getOrganization(orgId: string): {
      getTeams(): Promise<{
        status: number
        data: { id: string; slug: string }[]
      }>
    }
    getTeam(id: string): {
      addMembership(username: string): Promise<{
        status: number
        data: { state: "pending" | string; message: string; url: string }
      }>
    }
  }
  export = GitHubApi
}

declare module "uuid/v4.js" {
  export default function (): string
}
