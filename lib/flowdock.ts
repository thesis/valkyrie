// eslint-disable-next-line max-classes-per-file, import/no-named-default
import axios, { AxiosResponse, AxiosRequestConfig, AxiosHeaders } from "axios"

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore No types available.
import { Base64 } from "js-base64"

const API_BASE_URL = "https://api.flowdock.com"
const APP_BASE_URL = "https://www.flowdock.com/app"

const URLs = {
  messages: `${API_BASE_URL}/messages`,
  messageDetail: `${APP_BASE_URL}/{flowPath}/messages/{messageId}`,
  flow: `${APP_BASE_URL}/{flowPath}`,
  thread: `${APP_BASE_URL}/{flowPath}/threads/{threadId}`,
}

type Thread = {
  title: string
  external_url: string
  body: string
  fields: [{ label: string; value: string }]
}

type MessageAuthor = {
  name: string
  email?: string
  avatar?: string
}

type ActivityThread = {
  title: string
  author: MessageAuthor
  external_thread_id: string
  external_url: string

  thread: Thread
}

type ActivityMessage = {
  uuid: string
  title: string
  author: MessageAuthor
  external_thread_id: string
}

type DiscussionMessage = {
  uuid: string
  title: string
  body: string
  author: MessageAuthor
  external_thread_id: string
}

/**
 * Session represents a session of interactions with a Flowdock server.
 */
abstract class Session {
  protected readonly postFn: (
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ) => Promise<AxiosResponse>

  constructor(doPost: boolean) {
    if (doPost) {
      this.postFn = axios.post.bind(axios)
    } else {
      this.postFn = (url: string, data?: any, config?: AxiosRequestConfig) =>
        new Promise<AxiosResponse>((resolve) => {
          setTimeout(() => {
            console.log(
              `Flowdock POST to URL ${url} with data:\n`,
              `${JSON.stringify(data)}\nand config:\n${JSON.stringify(config)}`,
            )

            resolve({
              data: "",
              status: 200,
              statusText: "",
              headers: {},
              config: { ...config, headers: new AxiosHeaders() },
            })
          }, 1000)
        })
    }
  }
}

/**
 * AppSession represents a session of interactions with a Flowdock server.
 *
 * In this Session type, the apiToken must be a flow_token generated within an
 * integration for a third-party app.
 */
class AppSession extends Session {
  constructor(private apiToken: string, doPost = true) {
    super(doPost)
    this.apiToken = apiToken
  }

  async postActivity(message: ActivityThread | ActivityMessage) {
    return this.postFn(URLs.messages, {
      flow_token: this.apiToken,
      event: "activity",
      ...message,
    })
  }

  async postDiscussion(message: DiscussionMessage) {
    return this.postFn(URLs.messages, {
      flow_token: this.apiToken,
      event: "discussion",
      ...message,
    })
  }
}

/**
 * BasicAuthSession represents a session of interactions with a
 * Flowdock server, using Basic Auth.
 *
 * In a BasicAuthSession, the apiToken is the Personal API token for Hubot's
 * Flowdock account.
 */
class BasicAuthSession extends Session {
  constructor(private apiToken: string, doPost = true) {
    super(doPost)
    this.apiToken = apiToken
  }

  async postMessage(message: string, targetFlowId: string) {
    const apiToken = Base64.encode(this.apiToken)
    const header = {
      "Content-type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${apiToken}`,
      "X-flowdock-wait-for-message": true,
    }
    return this.postFn(
      URLs.messages,
      {
        event: "message",
        content: `${message}`,
        flow: targetFlowId,
      },
      { headers: header },
    )
  }
}

export { AppSession, BasicAuthSession, Session, URLs, APP_BASE_URL }
