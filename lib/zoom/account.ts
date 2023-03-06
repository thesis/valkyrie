import * as axios from "axios"
import URLs from "./urls.ts"
import { Meeting, MeetingScheduleCategory } from "./meeting.ts"
import { generateZoomPassword, tokenFrom } from "./password.ts"
import { UserType } from "./user.ts"

export default class Account {
  constructor(
    private email: string,
    private apiKey: string,
    private apiSecret: string,
    private type: UserType,
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
    )
    const { meetings } = response.data
    return meetings as Meeting[]
  }

  isBasic() {
    return this.type === UserType.Basic
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
    const newMeetingPassword = generateZoomPassword()
    const response = await axios.post(
      URLs.meetings.replace(/{userId}/, this.email),
      {
        topic: "Heimdall-initiated Zoom meeting",
        password: newMeetingPassword,
        settings: {
          join_before_host: true,
          host_video: true,
          participant_video: true,
          waiting_room: false,
          use_pmi: false,
        },
      },
      { params: { access_token: this.token } },
    )
    const meeting: Meeting = response.data

    meeting.app_url = URLs.appJoin
      .replace(/{meetingId}/, meeting.id)
      .replace(/{meetingPassword}/, meeting.encrypted_password || "")
    return [meeting, this.email, this.type] as const
  }

  private get token() {
    return tokenFrom(this.apiKey, this.apiSecret)
  }
}
