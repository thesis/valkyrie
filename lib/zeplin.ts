import { default as axios, AxiosResponse, AxiosPromise } from 'axios';
import util from 'util';
import cookie from 'cookie';
import querystring from 'querystring';

// Regexp that extracts the API data embedded in a Zeplin HTML page.
const EMBEDDED_API_DATA_REGEXP = /.*window.Zeplin\["apiData"\] = JSON.parse\("(.*)"\);/

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
    sizedImage: "https://img.zeplin.io/{snapshotUrl}?w={width}&cropTop=0&cropLeft=0&cropWidth={width}&cropHeight={height}"
}

type HtmlHeaders = { headers: { Cookie: string } }
type ApiHeaders = { headers: { 'zeplin-token': string } }

class Session {
    private _token?: string

    constructor(private username: string, private password: string) {}

    async getScreen(projectId: string, screenId: string) {
        const headers = await this.htmlHeaders();
        return new Screen(screenId, projectId, (url) => axios.get(url, headers))
    }

    async getProject(projectId: string) {
        const headers = await this.htmlHeaders();
        return new Project(projectId, (url) => axios.get(url, headers))
    }

    async getNotifications() {
        const headers = await this.apiHeaders(),
              result = await axios.get(URLs.notifications, headers);

        if (result.status != 200) {
            throw `failed to get Zeplin projects page: ${result.statusText} ${util.inspect(result)}`;
        } else {
            return result.data.notifications;
        }
    }

    async updateNotificationMarker() {
        const headers = await this.apiHeaders();

        return await axios.put(URLs.notificationMarker, null, headers);
    }

    private async setTokens() {
        const loginPage = await axios.get(URLs.login)
        if (loginPage.status != 200) {
            throw `failed to load login page for Zeplin: ${loginPage.statusText}, ${util.inspect(loginPage)})}`
        }

        let $loginPage = cheerio.load(loginPage.data);

        const formTarget = $loginPage('#loginForm').attr('target') || URLs.login;
        const usernameField = $loginPage('#handle').attr('name');
        const passwordField = $loginPage('#password').attr('name');
        let loginParams = {};
        loginParams[usernameField] = this.username;
        loginParams[passwordField] = this.password;

        const loginResult = await axios.post(
            URLs.loginApi,
            JSON.stringify(loginParams),
            { headers: { "Content-Type": "application/json" } }
        )
        if (loginResult.status != 200) {
            throw `failed to log in to Zeplin: ${loginResult.statusText}, ${util.inspect(loginResult)}`
        }
    }

    private async apiHeaders(): Promise<ApiHeaders> {
        if (!this._token) {
            await this.setTokens()
        }

        return { headers: { 'zeplin-token': this._token } };
    }

    private async htmlHeaders(): Promise<HtmlHeaders> {
        if (!this._token) {
            await this.setTokens()
        }

        return { headers: { Cookie: cookie.serialize('userToken', this._token) } };
    }
}

type Comment = {
    id: string,
    dotId: string,
    body: string,
    date: Date,
    creatorName: string,
    creatorEmail: string
}

class Screen {
    constructor(
        private id: string,
        private projectId: string,
        private zeplinGet: (url: string)=>AxiosPromise
    ) {}

    screenUrl() {
        return URLs.screen
                .replace(/{projectId}/, this.projectId)
                .replace(/{screenId}/, this.id);
    }

    dotUrl(dotId: string) {
        return this.commentUrl(dotId, '')
    }

    commentUrl(dotId: string, commentId: string) {
        const queryParams = {
            did: dotId,
            cmid: commentId
        };

        return this.screenUrl + `?${querystring.stringify(queryParams)}`
    }

    async getComments(): Promise<Array<Comment>> {
        const screenResponse = await this.zeplinGet(this.screenUrl()),
              apiDataString = EMBEDDED_API_DATA_REGEXP
                                 .exec(screenResponse.data)[1]
                                 .replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1"),
              apiDataJson = JSON.parse(apiDataString),
              apiData = JSON.parse(apiDataJson),
              dots = apiData.dots.dots,
              comments = dots.reduce((comments, dot) => {
                return dot.comments.reduce((comments, dotComment) => {
                    let comment = {
                        id: dotComment._id,
                        dotId: dot._id,
                        body: dotComment.note,
                        date: new Date(dotComment.created),
                        creatorName: dotComment.author.username,
                        creatorEmail: dotComment.author.email
                    }

                    comments.push(comment);

                    return comments;
                }, comments);
              }, []);

        // Chronologically oldest to newest.
        return comments.sort((a, b) => a.date - b.date);
    }

    // Returns the comments of this screen that are newer than the oldest
    // comment with an id in commentIds. This ensures that if you get a
    // notification of a comment but not its replies, this function will still
    // return its replies as well.
    async getCommentsNewerThanOldestOf(commentIds) {
        const allComments = await this.getComments(),
              idSet = new Set(commentIds),
              oldestCommentIndex = allComments.findIndex((c) => idSet.has(c.id))

        if (oldestCommentIndex == -1) {
            return [];
        } else {
            return allComments.slice(oldestCommentIndex);
        }
    }
}

class Project {
    constructor(
        private id: string,
        private zeplinGet: (url: string)=>AxiosPromise
    ) {}

    async screensById(): Promise<{[key: string]: Screen}> {
        const apiProjectUrl = URLs.apiProject.replace(/{projectId}/, this.id),
              projectResponse = await this.zeplinGet(apiProjectUrl),
              screenData = projectResponse.data.screens;

        // FIXME Need to capture screen metadata: name, latestVersion.snapshot, ..?
        return screenData.reduce((screensById, screen) => {
            screensById[screen._id] = new Screen(screen._id, this.id, this.zeplinGet);
            return screensById
        }, {})

    }
}

export { Project, Session, Screen }