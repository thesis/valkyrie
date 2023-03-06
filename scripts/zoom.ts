// Description:
//   Allows a chat user to request a random zoom meeting from an available account.
//
// Configuration:
//   ZOOM_API_SECRET - API secret for Zoom API, from https://developer.zoom.us/me/
//   ZOOM_API_KEY - API key for Zoom API, used to sign requests https://developer.zoom.us/me/
//   ZOOM_EXPECTED_MEETING_DURATION - Number of minutes hubot will watch a meeting (how long a hubot-initiated meeting is likely to last). Defaults to 60 if not specified.
//
// Commands:
//   hubot zoom - Responds with an available meeting from the registered accounts, follows up with a prompt to post meeting notes
import * as util from "util"
import { Adapter, Robot } from "hubot"
import {
  withConfigOrReportIssues,
  issueReporterForRobot,
} from "../lib/config.ts"
import * as zoom from "../lib/zoom/index.ts"
import { Meeting } from "../lib/zoom/meeting.ts"

let ZOOM_SESSION: zoom.Session | null = null

const INTERVAL_DELAY = 15 * 1000
const MEETING_START_TIMEOUT_DELAY = 10 * 60 * 1000 // we'll only watch this long if meeting doesn't start
const MEETING_DURATION_TIMEOUT_DELAY =
  parseInt(process.env.ZOOM_EXPECTED_MEETING_DURATION ?? "60", 10) * 60 * 1000 // max mtg watch duration in milliseconds

async function isMeetingStarted(meeting: Meeting) {
  if (ZOOM_SESSION === null) {
    return false
  }

  const meetingDetail = await zoom.getMeetingDetails(
    ZOOM_SESSION.token,
    meeting.id,
  )
  if ("status" in meetingDetail && meetingDetail.status === "started") {
    return true
  }
  return false
}

async function isMeetingFinished(meeting: Meeting, meetingDidStart: boolean) {
  if (ZOOM_SESSION === null) {
    return false
  }

  const meetingDetail = await zoom.getMeetingDetails(
    ZOOM_SESSION.token,
    meeting.id,
  )
  if (
    "status" in meetingDetail &&
    meetingDetail.status === "waiting" &&
    meetingDidStart === true
  ) {
    return true
  }
  return false
}

async function watchMeeting(meeting: Meeting) {
  const meetingStartedPromise = new Promise<boolean>((resolve, reject) => {
    let startTimeoutId: NodeJS.Timeout | undefined
    const startIntervalId = setInterval(() => {
      isMeetingStarted(meeting)
        .then((isStarted) => {
          if (isStarted === true) {
            clearInterval(startIntervalId)
            clearTimeout(startTimeoutId)
            resolve(true)
          }
        })
        .catch((err) => {
          reject(
            new Error(
              `Something went wrong setting up START watch interval: ${util.inspect(
                err,
                { depth: 0 },
              )}`,
            ),
          )
        })
    }, INTERVAL_DELAY)
    startTimeoutId = setTimeout(() => {
      clearInterval(startIntervalId)
      resolve(false)
    }, MEETING_START_TIMEOUT_DELAY)
  })
  const meetingStartStatus = await meetingStartedPromise
  const meetingFinishedPromise = new Promise((resolve_1, reject_1) => {
    if (meetingStartStatus === false) {
      resolve_1("never started")
      return
    }
    let endTimeoutId: NodeJS.Timeout | undefined
    const endIntervalId = setInterval(() => {
      isMeetingFinished(meeting, meetingStartStatus)
        .then((isFinished) => {
          if (isFinished === true) {
            clearInterval(endIntervalId)
            clearTimeout(endTimeoutId)
            resolve_1(true)
          }
        })
        .catch((err_1) => {
          reject_1(
            new Error(
              `Something went wrong setting up END watch interval: ${util.inspect(
                err_1,
                { depth: 0 },
              )}`,
            ),
          )
        })
    }, INTERVAL_DELAY)
    endTimeoutId = setTimeout(() => {
      clearInterval(endIntervalId)
      resolve_1(null)
    }, MEETING_DURATION_TIMEOUT_DELAY)
  })
  return meetingFinishedPromise
}

export default function setupZoom(robot: Robot<Adapter>) {
  withConfigOrReportIssues(
    issueReporterForRobot(robot),
    "ZOOM_API_KEY",
    "ZOOM_API_SECRET",
  )((zoomApiKey, zoomApiSecret) => {
    zoom
      .getSession(zoomApiKey, zoomApiSecret, MEETING_DURATION_TIMEOUT_DELAY)
      .then((session) => {
        ZOOM_SESSION = session
      })
      .catch((err) => {
        robot.logger.error(
          `Failed to set up Zoom session: ${util.inspect(err, { depth: 0 })}`,
        )
      })

    robot.respond(/zoom/, (res) => {
      if (!ZOOM_SESSION) {
        res.reply("Zoom session failed to set up properly!")
        return
      }
      ZOOM_SESSION.nextAvailableMeeting()
        .then((availableMeeting) => {
          if (availableMeeting === undefined) {
            throw new Error("No available meeting.")
          }

          const [meeting, zoomUserEmail] = availableMeeting
          robot.logger.info(
            `Created meeting: ${meeting.id}: using account for ${zoomUserEmail}`,
          )
          res.reply(
            `All set; open in [your browser](${meeting.join_url}) or [the app](${meeting.app_url})!`,
          )
          return meeting
        })
        .then(async (meeting) => {
          robot.logger.info(`Start watching meeting: ${meeting.id}`)
          try {
            const finalMeetingStatus = await watchMeeting(meeting)
            if (!finalMeetingStatus) {
              // if finalMeetingStatus is null, the meeting exceeded the timeout.
              // We assume the meeting still happened, so we still want to reply
              res.reply(
                `@${res.message.user.name} Don't forget to post meeting notes when your call ends!`,
              )
              robot.logger.info(
                `Stopped watching, meeting still going: ${meeting.id}`,
              )
            } else if (finalMeetingStatus === "never started") {
              // log, send flowdock note but no `@` mention
              robot.logger.info(
                `This meeting looks like it never started: ${meeting.id}`,
              )
              res.reply(
                "Looks like you didn't need this meeting, after all. If do you still need a zoom, please start a new one :)",
              )
            } else {
              // otherwise, send flowdock prompt
              res.reply(`@${res.message.user.name} Please post call notes!`)
              robot.logger.info(
                `Stopped watching, meeting ended: ${meeting.id}`,
              )
            }
          } catch (err) {
            robot.logger.error(
              `Failed to fetch meeting details for ${
                meeting.id
              }. ERR: ${util.inspect(err, { depth: 0 })}`,
            )
            // We assume the meeting still happened, so reply (but without `@`)
            res.reply(
              "Something went wrong watching the meeting; don't forget to post meeting notes when your call ends!",
            )
          }
        })
        .catch((err) => {
          robot.logger.error(
            `Failed to fetch next available meeting: ${util.inspect(err, {
              depth: 0,
            })}`,
          )
          res.reply("Uh-oh, there was an issue finding an available meeting :(")
        })
    })
  })
}
