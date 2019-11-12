import axios from "axios"
import * as jwt from "jsonwebtoken"
import * as moment from "moment"
import * as util from "util"

const API_BASE_URL = "https://api.zoom.us/v2",
  APP_BASE_URL = "zoommtg://zoom.us"
const URLs = {
  meetings: `${API_BASE_URL}/users/{userId}/meetings`,
  meetingDetail: `${API_BASE_URL}/meetings/{meetingId}`,
  users: `${API_BASE_URL}/users`,
  appJoin: `${APP_BASE_URL}/join?action=join&confno={meetingId}`,
}

function tokenFrom(apiKey: string, apiSecret: string) {
  const payload = {
    iss: apiKey,
    exp: new Date().getTime() + 100000,
  }

  return jwt.sign(payload, apiSecret)
}

async function getSession(
  apiKey: string,
  apiSecret: string,
  meetingLengthBuffer: number, // in milliseconds
) {
  const token = tokenFrom(apiKey, apiSecret),
    userResponse = await axios.get(URLs.users, {
      params: { access_token: token },
    })

  if (userResponse.status != 200) {
    throw `Error looking up users: ${util.inspect(userResponse.data)}.`
  } else {
    // NB: We currently do not have to handle pagination, because we have fewer
    // users than the number of potential results per page (30).
    // If our user count (user.data.total_records) grows to exceed that, we'll
    // need to update this to handle pagination.
    return new Session(
      apiKey,
      apiSecret,
      userResponse.data.users,
      meetingLengthBuffer,
    )
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

class Session {
  constructor(
    private apiKey: string,
    private apiSecret: string,
    private users: User[],
    private meetingLengthBuffer: number,
  ) {}

  // Checks all available session accounts and creates a meeting on an
  // account that has no other meeting currently running, or scheduled to start
  // within the time specified by meetingLengthBuffer.
  async nextAvailableMeeting() {
    let now = moment()
    let bufferExpiryTime = moment(now).add(
      this.meetingLengthBuffer,
      "milliseconds",
    )

    const accountMeetings = await Promise.all(
      Array.from(
        this.users.map(u => this.accountFromUser(u.email, u.type)),
      ).map(async function(accountSession): Promise<[Account, boolean]> {
        // filter out any upcoming or scheduled meetings starting within meetingLengthBuffer
        let upcoming = await accountSession.upcomingMeetings()
        let upcomingMeetingsInBuffer = upcoming.filter(meeting =>
          meeting.start_time
            ? moment(meeting.start_time).isBetween(now, bufferExpiryTime)
            : false,
        )
        let scheduled = await accountSession.scheduledMeetings()
        let scheduledMeetingsInBuffer = scheduled.filter(meeting =>
          meeting.start_time
            ? moment(meeting.start_time).isBetween(now, bufferExpiryTime)
            : false,
        )
        let live = await accountSession.liveMeetings()
        return [
          accountSession,
          live.length == 0 &&
            upcomingMeetingsInBuffer.length == 0 &&
            scheduledMeetingsInBuffer.length == 0,
        ]
      }),
    )

    const availableSessions = accountMeetings
      .filter(([, availableForMeeting]) => availableForMeeting)
      .map(([session]) => session)

    const availableProSessions = availableSessions.filter(
      session => session.type > 1,
    )
    const availableBasicSessions = availableSessions.filter(
      session => session.type == 1,
    )

    const candidateSessions =
      (availableProSessions.length > 0 && availableProSessions) ||
      availableBasicSessions

    const chosenIndex = Math.floor(Math.random() * candidateSessions.length)
    return await candidateSessions[chosenIndex].createMeeting()
  }

  private get token() {
    return tokenFrom(this.apiKey, this.apiSecret)
  }

  private accountForEmail(email: string) {
    return new Account(email, this.apiKey, this.apiSecret, null)
  }

  private accountFromUser(email: string, type: number) {
    return new Account(email, this.apiKey, this.apiSecret, type)
  }
}

enum MeetingScheduleCategory {
  LIVE = "live",
  SCHEDULED = "scheduled",
  UPCOMING = "upcoming",
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
    private type?: UserType,
  ) {}

  // NB: we may run into pagination issues at some point, especially for
  // SCHEDULED (which returns past events)
  // optional param "page_size" default: 30,/ max 300, "page_number" default: 1
  private async getMeetings(meetingCategory: MeetingScheduleCategory) {
    const response = await axios.get(
        URLs.meetings.replace(/{userId}/, this.email),
        {
          params: {
            access_token: this.token,
            type: meetingCategory,
          },
        },
      ),
      meetings: Meeting[] = response.data.meetings
    return meetings
  }

  async liveMeetings() {
    return this.getMeetings(MeetingScheduleCategory.LIVE)
  }

  async scheduledMeetings() {
    return this.getMeetings(MeetingScheduleCategory.SCHEDULED)
  }

  async upcomingMeetings() {
    return this.getMeetings(MeetingScheduleCategory.UPCOMING)
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
            waiting_room: false,
            use_pmi: false,
          },
        },
        { params: { access_token: this.token } },
      ),
      meeting: Meeting = response.data

    meeting.app_url = URLs.appJoin.replace(/{meetingId}/, meeting.id)
    return [meeting, this.email, this.type]
  }

  private get token() {
    return tokenFrom(this.apiKey, this.apiSecret)
  }
}

export { getSession, Session, getMeetingDetails }
