// Description:
//   Allows a chat user to request a random zoom meeting from an available
//   account.
//
// Configuration:
//   ZOOM_API_SECRET - API secret for Zoom API, from https://developer.zoom.us/me/
//   ZOOM_API_KEY - API key for Zoom API, used to sign requests https://developer.zoom.us/me/
//   ZOOM_EXPECTED_MEETING_DURATION - Number of minutes hubot will watch a meeting (how long a hubot-initiated meeting is likely to last). Defaults to 60 if not specified.
//
// Commands:
//   hubot zoom - Responds with an available meeting from the registered accounts, follows up with a prompt to post meeting notes

const { fetchConfigOrReportIssue } = require("../lib/config")
const zoom = require("../lib/zoom"),
  util = require("util")

/** @type zoom.Session */
let ZOOM_SESSION = null

const INTERVAL_DELAY = 15 * 1000
const MEETING_START_TIMEOUT_DELAY = 10 * 60 * 1000 // we'll only watch this long if meeting doesn't start
const MEETING_DURATION_TIMEOUT_DELAY =
  (parseInt(process.env["ZOOM_EXPECTED_MEETING_DURATION"]) || 60) * 60 * 1000 // max mtg watch duration in milliseconds

function isMeetingStarted(meeting) {
  return zoom
    .getMeetingDetails(ZOOM_SESSION.token, meeting.id)
    .then(meetingDetail => {
      if ("status" in meetingDetail && meetingDetail.status === "started") {
        return true
      } else {
        return false
      }
    })
}

function isMeetingFinished(meeting, meetingDidStart) {
  return zoom
    .getMeetingDetails(ZOOM_SESSION.token, meeting.id)
    .then(meetingDetail => {
      if (
        "status" in meetingDetail &&
        meetingDetail.status == "waiting" &&
        meetingDidStart === true
      ) {
        return true
      } else {
        return false
      }
    })
}

function watchMeeting(meeting) {
  let meetingStartedPromise = new Promise((resolve, reject) => {
    let startIntervalId = setInterval(function() {
      isMeetingStarted(meeting)
        .then(isStarted => {
          if (isStarted === true) {
            clearInterval(startIntervalId)
            clearTimeout(startTimeoutId)
            resolve(true)
          }
        })
        .catch(err => {
          reject(
            `Something went wrong setting up START watch interval: ${util.inspect(
              err,
            )}`,
          )
          return
        })
    }, INTERVAL_DELAY)
    let startTimeoutId = setTimeout(() => {
      clearInterval(startIntervalId)
      resolve(false)
    }, MEETING_START_TIMEOUT_DELAY)
  })
  return meetingStartedPromise.then(meetingStartStatus => {
    let meetingFinishedPromise = new Promise((resolve, reject) => {
      if (meetingStartStatus === false) {
        resolve("never started")
        return
      }
      let endIntervalId = setInterval(function() {
        isMeetingFinished(meeting, meetingStartStatus)
          .then(isFinished => {
            if (isFinished === true) {
              clearInterval(endIntervalId)
              clearTimeout(endTimeoutId)
              resolve(true)
            }
          })
          .catch(err => {
            reject(
              `Something went wrong setting up END watch interval: ${util.inspect(
                err,
              )}`,
            )
            return
          })
      }, INTERVAL_DELAY)
      let endTimeoutId = setTimeout(() => {
        clearInterval(endIntervalId)
        resolve(null)
      }, MEETING_DURATION_TIMEOUT_DELAY)
    })
    return meetingFinishedPromise
  })
}

module.exports = function(robot) {
  zoom
    .getSession(
      process.env["ZOOM_API_KEY"],
      process.env["ZOOM_API_SECRET"],
      MEETING_DURATION_TIMEOUT_DELAY,
    )
    .then(session => (ZOOM_SESSION = session))
    .catch(err => {
      robot.logger.error("Failed to set up Zoom session:", util.inspect(err))
    })

  robot.respond(/zoom/, res => {
    if (!ZOOM_SESSION) {
      res.send("Zoom session failed to set up properly!")
      return
    }
    ZOOM_SESSION.nextAvailableMeeting()
      .then(meeting => {
        res.send(
          `All set; open in [the app](${meeting.app_url}) or [your browser](${meeting.join_url})!`,
        )
        return meeting
      })
      .catch(err => {
        robot.logger.error(
          "Failed to fetch next available meeting:",
          util.inspect(err),
        )
        res.send("Uh-oh, there was an issue finding an available meeting :(")
      })
      .then(meeting => {
        robot.logger.info(`Start watching meeting: ${meeting.id}`)
        return watchMeeting(meeting)
          .then(finalMeetingStatus => {
            if (!finalMeetingStatus) {
              // if finalMeetingStatus is null, the meeting exceeded the timeout.
              // We assume the meeting still happened, so we still want to reply
              res.send(
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
              res.send(
                `Looks like you didn't need this meeting, after all. If do you still need a zoom, please start a new one :)`,
              )
            } else {
              // otherwise, send flowdock prompt
              res.send(`@${res.message.user.name} Please post call notes!`)
              robot.logger.info(
                `Stopped watching, meeting ended: ${meeting.id}`,
              )
            }
          })
          .catch(err => {
            robot.logger.error(
              `Failed to fetch meeting details for ${meeting.id}. ERR:`,
              util.inspect(err),
            )
            // We assume the meeting still happened, so reply (but without `@`)
            res.send(
              `Something went wrong watching the meeting; don't forget to post meeting notes when your call ends!`,
            )
          })
      })
  })
}
