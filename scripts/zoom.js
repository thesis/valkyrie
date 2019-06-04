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
      })
      .catch(err => {
        robot.logger.error(
          "Failed to fetch next available meeting:",
          util.inspect(err),
        )
        res.send("Uh-oh, there was an issue finding an available meeting :(")
      })
  })
}
