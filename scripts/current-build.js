// Description:
//   Returns the current deployed build.
//
// Configuration:
//   RELEASE_NOTIFICATION_ROOM - Id of the room for release notifications.
//
// Commands:
//   hubot current build - Responds with a link to the associated build in CircleCI.
//
// Author:
//   shadowfiend

const fs = require("fs")
const { isRoomNameValid } = require("../lib/adapter-util")

let buildNumberBuffer = Buffer.from("")
try {
  buildNumberBuffer = fs.readFileSync(`${__dirname}/../BUILD`)
} catch (e) {
  console.error(`Error reading buildNumber file: ${e}`)
}
const buildNumber = buildNumberBuffer.toString().trim()
const buildString = buildNumber
  ? `build [${buildNumber}](https://circleci.com/gh/thesis/heimdall/${buildNumber})`
  : "unknown build"

function sendReleaseNotification(robot) {
  const alertRoom = process.env.RELEASE_NOTIFICATION_ROOM
  if (isRoomNameValid(robot.adapter, alertRoom)) {
    robot.send(
      {
        room: alertRoom,
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

module.exports = function (robot) {
  sendReleaseNotification(robot)

  robot.respond(/current build/, (response) =>
    response.send(`I'm on ${buildString}!`),
  )
}
