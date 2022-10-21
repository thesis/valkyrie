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

import fs from "fs"
import { Robot } from "hubot"
import { isRoomNameValid } from "../lib/adapter-util"

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

function sendReleaseNotification(robot: Robot) {
  const alertRoom = process.env.RELEASE_NOTIFICATION_ROOM
  if (alertRoom !== undefined && isRoomNameValid(robot.adapter, alertRoom)) {
    robot.messageRoom(alertRoom, `Released ${buildString}!`)
  }
}

module.exports = function setUpCurrentBuild(robot: Robot) {
  sendReleaseNotification(robot)

  robot.respond(/current build/, (response) =>
    response.send(`I'm on ${buildString}!`),
  )
}
