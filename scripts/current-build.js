// Description:
//   Returns the current deployed build.
//
// Configuration:
//   RELEASE_NOTIFICATION_ROOM - Id of the room for release notifications.
//
// Commands:
//   hubot current build
//
// Author:
//   shadowfiend

const { isAlertRoomNameValid } = require("../lib/config")

let fs = require("fs")

let buildNumberBuffer = new Buffer("")
try {
  buildNumberBuffer = fs.readFileSync(`${__dirname}/../BUILD`)
} catch (e) {
  console.error("Error reading buildNumber file: " + e)
}
let buildNumber = buildNumberBuffer.toString().trim()
let buildString = buildNumber
  ? `build [${buildNumber}](https://circleci.com/gh/thesis/heimdall/${buildNumber})`
  : `unknown build`

function sendReleaseNotification(robot) {
  let alertRoom = process.env["RELEASE_NOTIFICATION_ROOM"]
  if (isAlertRoomNameValid(alertRoom)) {
    robot.send(
      {
        room: releaseNotificationRoom,
      },
      `Released ${buildString}!`,
    )
  }
}

function attachToStream(fn) {
  setTimeout(() => {
    if (!fn()) {
      attachToStream(fn)
    }
  })
}

module.exports = function(robot) {
  sendReleaseNotification(robot)

  robot.respond(/flows/, response => {
    if (robot.adapter.flows != null) {
      response.send(
        robot.adapter.flows
          .map(flow => ` - ${flow.name}: ${flow.id}`)
          .join("\n"),
      )
    } else {
      response.send("Not using flowdock.")
    }
  })

  robot.respond(/current build/, response =>
    response.send(`I'm on ${buildString}!`),
  )
}
