import axios from "axios"
import * as jwt from "jsonwebtoken"
import * as util from "util"

const API_BASE_URL = "https://api.zoom.us/v2",
  APP_BASE_URL = "zoommtg://zoom.us"
const URLs = {
  meetings: `${API_BASE_URL}/users/{userId}/meetings`,
  meetingDetail: `${API_BASE_URL}/meetings/{meetingId}`,
  users: `${API_BASE_URL}/users`,
  appJoin: `${APP_BASE_URL}/join?action=join&confno={meetingId}`,
}
const MEETING_BUFFER = +process.env["ZOOM_MEETING_DURATION"] * 60 * 1000

function tokenFrom(apiKey: string, apiSecret: string) {
  const payload = {
    iss: apiKey,
    exp: new Date().getTime() + 100000,
  }

  return jwt.sign(payload, apiSecret)
}

async function getSession(apiKey: string, apiSecret: string) {
  const token = tokenFrom(apiKey, apiSecret),
    userResponse = await axios.get(URLs.users, {
      params: { access_token: token },
    })

  if (userResponse.status != 200) {
    throw `Error looking up users: ${util.inspect(userResponse.data)}.`
  } else {
    return new Session(apiKey, apiSecret, userResponse.data.users)
  }
}

async function getMeetingDetails(sessionToken: string, meetingId: string) {
  try {
    const response = await axios.get(
      URLs.meetingDetail.replace(/{meetingId}/, meetingId),
      { params: { access_token: sessionToken } },
    )
    return response.data
  } catch (err) {
    throw `Something went wrong getting meeting details: ${util.inspect(err)}.`
  }
}

enum UserType {
  Basic = 1,
  Pro,
  Corp,
}

type User = {
  id: string
  email: string
  type: UserType
  timezone: string
}

function isDatetimeWithinRange(
  datetimeToCheck: datetime,
  rangeStart: datetime,
  rangeEnd: datetime,
) {
  return datetimeToCheck > rangeStart && datetimeToCheck < rangeEnd
}

class Session {
  constructor(
    private apiKey: string,
    private apiSecret: string,
    private users: User[],
  ) {}

  // Checks all available session accounts and creates a meeting on an
  // account that has no other meeting currently running, or scheduled to start
  // withing the time specified by MEETING_BUFFER.
  async nextAvailableMeeting() {
    let now = new Date()
    let bufferExpiryTime = new Date(now + MEETING_BUFFER)
    const accountMeetings = await Promise.all(
      Array.from(this.users.map(u => u.email))
        .map(email => this.accountForEmail(email))
        .map(async function(accountSession): Promise<[Account, boolean]> {
          let liveMeetings = await accountSession.getMeetings("live")
          // filter out any upcoming or scheduled meetings starting in next hour:
          let upcomingMeetings = await accountSession.getMeetings("scheduled")
          let upcomingMeetingsInBuffer = upcomingMeetings.filter(meeting =>
            meeting.start_time
              ? isDatetimeWithinRange(
                  new Date(meeting.start_time),
                  now,
                  bufferExpiryTime,
                )
              : false,
          )
          let scheduledMeetings = await accountSession.getMeetings("upcoming")
          let scheduledMeetingsInBuffer = scheduledMeetings.filter(meeting =>
            meeting.start_time
              ? isDatetimeWithinRange(
                  new Date(meeting.start_time),
                  now,
                  bufferExpiryTime,
                )
              : false,
          )
          return [
            accountSession,
            liveMeetings.length == 0 &&
              upcomingMeetingsInBuffer.length == 0 &&
              scheduledMeetingsInBuffer.length == 0,
          ]
        }),
    )

    const availableSessions = accountMeetings
      .filter(([, availableForMeeting]) => availableForMeeting)
      .map(([session]) => session)
    const chosenIndex = Math.floor(Math.random() * availableSessions.length)
    return await availableSessions[chosenIndex].createMeeting()
  }

  private get token() {
    return tokenFrom(this.apiKey, this.apiSecret)
  }

  private accountForEmail(email: string) {
    return new Account(email, this.apiKey, this.apiSecret)
  }
}

enum MeetingType {
  Instant = 1,
  Scheduled = 2,
  FloatingRecurring = 3,
  FixedRecurring = 8,
}

type Meeting = {
  id: string
  topic: string
  type: MeetingType
  agenda: string
  start_time: string
  join_url: string
  app_url?: string
}

class Account {
  constructor(
    private email: string,
    private apiKey: string,
    private apiSecret: string,
  ) {}

  async getMeetings(returnType: string) {
    const response = await axios.get(
        URLs.meetings.replace(/{userId}/, this.email),
        {
          params: {
            access_token: this.token,
            type: returnType,
          },
        },
      ),
      meetings: Meeting[] = response.data.meetings
    return meetings
  }

  async createMeeting() {
    const response = await axios.post(
        URLs.meetings.replace(/{userId}/, this.email),
        {
          topic: "Heimdall-initiated Zoom meeting",
          settings: {
            join_before_host: true,
            host_video: true,
            participant_video: true,
          },
        },
        { params: { access_token: this.token } },
      ),
      meeting: Meeting = response.data

    meeting.app_url = URLs.appJoin.replace(/{meetingId}/, meeting.id)

    return meeting
  }

  private get token() {
    return tokenFrom(this.apiKey, this.apiSecret)
  }
}

export { getSession, Session, getMeetingDetails }
