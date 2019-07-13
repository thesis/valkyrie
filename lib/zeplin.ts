import { default as axios, AxiosPromise } from "axios"
import * as cheerio from "cheerio"
import * as cookie from "cookie"
import * as querystring from "querystring"
import * as util from "util"

// Regexp that extracts the API data embedded in a Zeplin HTML page.
const EMBEDDED_API_DATA_REGEXP = /.*window.Zeplin\["apiData"\] = JSON.parse\("(.*)"\);/

const ERROR_DEPTH = 0

const URLs = {
  login: "https://app.zeplin.io/login",
  loginApi: "https://api.zeplin.io/users/login",
  projects: "https://app.zeplin.io/projects",
  notifications: "https://api.zeplin.io/notifications?count=10",
  notificationMarker: "https://api.zeplin.io/users/notificationLastReadTime",
  project: "https://app.zeplin.io/project/{projectId}",
  apiProject: "https://api.zeplin.io/projects/{projectId}",
  projectDashboard: "https://app.zeplin.io/project/{projectId}/dashboard",
  screen: "https://app.zeplin.io/project/{projectId}/screen/{screenId}",
  sizedImage:
    "https://img.zeplin.io/{snapshotUrl}?w={width}&cropTop=0&cropLeft=0&cropWidth={width}&cropHeight={height}",
}

type HtmlHeaders = { headers: { Cookie: string } }
type ApiHeaders = { headers: { "zeplin-token": string } }
type ZeplinFetchers = {
  api: (url: string) => AxiosPromise
  html: (url: string) => AxiosPromise
}

class Session {
  private _token?: string

  constructor(private username: string, private password: string) {}

  async getScreen(projectId: string, screenId: string) {
    const fetchers = await this.fetchers()
    return new Screen(screenId, projectId, fetchers)
  }

  async getProject(
    projectIdOrProps:
      | string
      | { _id?: string; id?: string; [key: string]: string },
  ) {
    const fetchers = await this.fetchers()

    if (typeof projectIdOrProps === "string") {
      return new Project(projectIdOrProps, fetchers)
    } else {
      let { id, name, type } = projectIdOrProps
      id = id || projectIdOrProps._id

      return new Project(id, fetchers, { name, type })
    }
  }

  async getNotifications() {
    const headers = await this.apiHeaders(),
      result = await axios.get(URLs.notifications, headers)

    if (result.status != 200) {
      throw `failed to get Zeplin projects page: ${
        result.statusText
      } ${util.inspect(result)}`
    } else {
      return result.data.notifications
    }
  }

  async updateNotificationMarker() {
    const headers = await this.apiHeaders()

    return await axios.put(URLs.notificationMarker, null, headers)
  }

  private async fetchers() {
    const apiHeaders = await this.apiHeaders(),
      htmlHeaders = await this.htmlHeaders()

    return {
      api: url => axios.get(url, apiHeaders),
      html: url => axios.get(url, htmlHeaders),
    }
  }

  private async setTokens() {
    const loginPage = await axios.get(URLs.login)
    if (loginPage.status != 200) {
      throw `failed to load login page for Zeplin: ${
        loginPage.statusText
      }, ${util.inspect(loginPage)})}`
    }

    let $loginPage = cheerio.load(loginPage.data)

    const usernameField = $loginPage("#handle").attr("name")
    const passwordField = $loginPage("#password").attr("name")
    let loginParams = {}
    loginParams[usernameField] = this.username
    loginParams[passwordField] = this.password

    const loginResult = await axios.post(
      URLs.loginApi,
      JSON.stringify(loginParams),
      { headers: { "Content-Type": "application/json" } },
    )
    if (loginResult.status != 200) {
      throw `failed to log in to Zeplin: ${
        loginResult.statusText
      }, ${util.inspect(loginResult)}`
    }

    this._token = loginResult.data.token
  }

  private async apiHeaders(): Promise<ApiHeaders> {
    if (!this._token) {
      await this.setTokens()
    }

    return { headers: { "zeplin-token": this._token } }
  }

  private async htmlHeaders(): Promise<HtmlHeaders> {
    if (!this._token) {
      await this.setTokens()
    }

    return { headers: { Cookie: cookie.serialize("userToken", this._token) } }
  }
}

type Comment = {
  id: string
  dotId: string
  body: string
  date: Date
  creatorName: string
  creatorEmail: string
}

type Author = {
  username: string
  email: string
}

type DotComment = {
  _id: string
  note: string
  created: string
  author: Author
}

type Dot = {
  _id: string
  comments: DotComment[]
}

type Snapshot = {
  url: string
  width: number
  height: number
}

type ScreenVersion = {
  created: string
  snapshot: Snapshot
}

type ScreenApiData = {
  name: string
  versions: ScreenVersion[]
  dots: {
    dots: Dot[]
  }
}

class Screen {
  private _apiData: ScreenApiData

  constructor(
    public id: string,
    private projectId: string,
    private fetchers: ZeplinFetchers,
    private fields: { name?: string; snapshot?: Snapshot } = {},
  ) {}

  private async apiData(): Promise<ScreenApiData> {
    if (this._apiData) {
      return this._apiData
    }

    const screenResponse = await this.fetchers.html(this.url),
      screenData: string = screenResponse.data,
      // Extract API data from expression.
      apiDataMatch = EMBEDDED_API_DATA_REGEXP.exec(screenData) || ["", ""],
      apiDataString = apiDataMatch[1]
        // Replace HTML/JS unicode escapey thingies
        // (\x..-style) with JSON unicode escapes
        // (\u00..-style).
        .replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1"),
      // Parse as a JSON string.
      apiDataJson = JSON.parse(`"${apiDataString}"`)

    if (apiDataJson === "{}") {
      throw { code: "not-found", error: "Screen no longer exists." }
    }

    let parsedJson = JSON.parse(apiDataJson)
    parsedJson.versions = parsedJson.versions.versions

    this._apiData = parsedJson
    return this._apiData
  }

  get name(): string {
    return this.fields.name || ""
  }

  async properties() {
    return await this.apiData()
  }

  async snapshotUrl() {
    const apiData = await this.apiData(),
      snapshotData = apiData.versions[0].snapshot,
      url = URLs.sizedImage
        .replace(/{snapshotUrl}/, encodeURIComponent(snapshotData.url))
        .replace(/{width}/g, String(snapshotData.width))
        .replace(/{height}/g, String(snapshotData.height))

    return url
  }

  get url() {
    return URLs.screen
      .replace(/{projectId}/, this.projectId)
      .replace(/{screenId}/, this.id)
  }

  dotUrl(dotId: string) {
    return this.commentUrl(dotId, "")
  }

  commentUrl(dotId: string, commentId: string) {
    const queryParams = {
      did: dotId,
      cmid: commentId,
    }

    return this.url + `?${querystring.stringify(queryParams)}`
  }

  async getComments() {
    const apiData = await this.apiData(),
      dots = apiData.dots.dots,
      comments = dots.reduce((comments: Comment[], dot) => {
        return dot.comments.reduce((comments, dotComment) => {
          let comment = {
            id: dotComment._id,
            dotId: dot._id,
            body: dotComment.note,
            date: new Date(dotComment.created),
            creatorName: dotComment.author.username,
            creatorEmail: dotComment.author.email,
          }

          comments.push(comment)

          return comments
        }, comments)
      }, [])

    // Chronologically oldest to newest.
    return comments.sort((a, b) => a.date.getTime() - b.date.getTime())
  }

  // Returns the comments of this screen that are newer than the oldest
  // comment with an id in commentIds. This ensures that if you get a
  // notification of a comment but not its replies, this function will still
  // return its replies as well.
  async getCommentsNewerThanOldestOf(commentIds) {
    const allComments = await this.getComments(),
      idSet = new Set(commentIds),
      oldestCommentIndex = allComments.findIndex(c => idSet.has(c.id))

    if (oldestCommentIndex == -1) {
      return []
    } else {
      return allComments.slice(oldestCommentIndex)
    }
  }
}

class Project {
  constructor(
    public id: string,
    private fetchers: ZeplinFetchers,
    private fields: { name?: string; type?: string } = {},
  ) {}

  get url(): string {
    return URLs.project.replace(/{projectId}/, this.id)
  }

  get name(): string {
    return this.fields.name || ""
  }

  get type(): string {
    return this.fields.type || ""
  }

  getScreen(id: string, name: string) {
    return new Screen(id, this.id, this.fetchers, { name })
  }

  async screensById() {
    const apiProjectUrl = URLs.apiProject.replace(/{projectId}/, this.id),
      projectResponse = await this.fetchers.api(apiProjectUrl),
      screenData: any[] = projectResponse.data.screens

    // FIXME Need to capture screen metadata: name, latestVersion.snapshot, ..?
    return screenData.reduce<{ [id: string]: Screen }>(
      (screensById, screen) => {
        screensById[screen._id] = new Screen(
          screen._id,
          this.id,
          this.fetchers,
          {
            name: screen.name,
            snapshot: screen.snapshot,
          },
        )
        return screensById
      },
      {},
    )
  }
}

export { Project, Session, Screen }
