// Description:
//   Allows a chat user to request a random zoom meeting from an available
//   account.
//
// Configuration:
//   ZOOM_API_SECRET - API secret for Zoom API, from https://developer.zoom.us/me/
//   ZOOM_API_KEY - API key for Zoom API, used to sign requests https://developer.zoom.us/me/
//
// Commands:
//   hubot zoom - Responds with an available meeting from the registered accounts

const zoom = require("../lib/zoom"),
  util = require("util")

/** @type zoom.Session */
let ZOOM_SESSION = null
// temp numbers for testing
const INTERVAL_DELAY = 5000 //30 * 1000 //
const MEETING_START_TIMEOUT_DELAY = 1 * 60 * 1000 // 10 * 60 * 1000 // we'll only watch this long if meeting doesn't start
const MEETING_DURATION_TIMEOUT_DELAY = 2 * 60 * 1000 // 60 * 60 * 1000 // approx max mtg duration

function isMeetingStarted(meeting) {
  return zoom
    .getMeetingDetails(ZOOM_SESSION.token, meeting.id, meeting.uuid)
    .then(meetingDetail => {
      console.log(`\n\n\n##############\nSTARTED? meetingDetail`)
      console.log(require("util").inspect(meetingDetail))
      if ("status" in meetingDetail && meetingDetail.status === "started") {
        return true
      } else {
        return false
      }
    })
}

// TODO: add hasStarted param & condition, otherwise this is a lie if called by itself
function isMeetingFinished(meeting, meetingDidStart) {
  return zoom
    .getMeetingDetails(ZOOM_SESSION.token, meeting.id, meeting.uuid)
    .then(meetingDetail => {
      console.log(`\n\n\n##############\nENDED? meetingDetail`)
      console.log(require("util").inspect(meetingDetail))
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
  let startIntervalIdPromise = new Promise((resolve, reject) => {
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
      resolve("never started")
    }, MEETING_START_TIMEOUT_DELAY)
  })
  return startIntervalIdPromise.then(meetingStartStatus => {
    let endIntervalIdPromise = new Promise((resolve, reject) => {
      if (meetingStartStatus === "never started") {
        resolve("never started")
        return
      }
      let endIntervalId = setInterval(function() {
        isMeetingFinished(meeting, meetingStartStatus)
          .then(isFinished => {
            if (isFinished === true) {
              clearInterval(endIntervalId)
              clearTimeout(endTimeoutId)
              resolve(null)
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
    return endIntervalIdPromise
  })
}

module.exports = function(robot) {
  zoom
    .getSession(process.env["ZOOM_API_KEY"], process.env["ZOOM_API_SECRET"])
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
        return
      })
      .then(meeting => {
        robot.logger.info(`Start watching meeting: ${meeting.id}`)
        return watchMeeting(meeting)
          .then(fulfilledPromise => {
            if (fulfilledPromise && fulfilledPromise === "never started") {
              // log, but do not send flowdock prompt
              robot.logger.info(
                `This meeting looks like it never started: ${meeting.id}`,
              )
              return
            }
            // otherwise, send flowdock prompt
            res.send(`@${res.message.user.name} Please post call notes!`)
            robot.logger.info(`Stopped watching meeting: ${meeting.id}`)
          })
          .catch(err => {
            robot.logger.error(
              `Failed to fetch meeting details for ${meeting.id}. ERR:`,
              util.inspect(err),
            )
            // We assume the meeting still happened, so we still want to send:
            res.send(
              `@${res.message.user.name} Don't forget to post meeting notes when your call ends!`,
            )
          })
      })
  })
}
