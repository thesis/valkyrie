import {default as axios,AxiosResponse,AxiosRequestConfig} from 'axios';

const URLs = {
    messages: `https://api.flowdock.com/messages`
};

type Thread = {
    title: string
    external_url: string
    body: string
    fields: [{ label: string, value: string }]
}

type MessageAuthor = {
    name: string
    email?: string
    avatar?: string
}

// flow_token = ...
// event = 'activity'
// 
type ActivityThread = {
    title: string
    author: MessageAuthor
    external_thread_id: string
    external_url: string

    thread: Thread
}

type ActivityMessage = {
    title: string
    author: MessageAuthor
    external_thread_id: string
}

type DiscussionMessage = {
    title: string
    author: MessageAuthor
    external_thread_id: string
}

/**
 * FlowdockSession represents a session of interactions with a Flowdock server.
 * This session is authenticated by the `apiToken` passed to the constructor.
 */
class Session {
    private apiToken: string
    private postFn: (url:string,data?:any,config?:AxiosRequestConfig)=>Promise<AxiosResponse>

    constructor(apiToken: string, doPost: boolean = true) {
        this.apiToken = apiToken

        if (doPost) {
            this.postFn = axios.post.bind(axios)
        } else {
            this.postFn = (url: string, data?: any, config?: AxiosRequestConfig) => {
                console.log(`Flowdock POST to URL ${url} with data:\n`,
                    `${JSON.stringify(data)}\nand config:\n${JSON.stringify(config)}`);
                
                return new Promise<AxiosResponse>((resolve)=>resolve({
                    data: "",
                    status: 200,
                    statusText: "",
                    headers: {},
                    config: config
                }));
            }
        }
    }

    async postActivity(message: ActivityThread | ActivityMessage) {

        return this.postFn(
            URLs.messages,
            {
                flow_token: this.apiToken,
                event: 'activity',
                ...message
            }
        )
    }

    async postDiscussion(message: DiscussionMessage) {
        return this.postFn(
            URLs.messages,
            {
                flow_token: this.apiToken,
                event: 'discussion',
                ...message
            }
        )
    }
}

export { Session }