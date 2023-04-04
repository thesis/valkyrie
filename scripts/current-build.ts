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

import { dirname } from "path"
import { fileURLToPath } from "url"

import * as fs from "fs"
import { Robot } from "hubot"

let buildNumberBuffer = Buffer.from("")
try {
  // Replacement for global __dirname constant in CJS modules.
  // eslint-disable-next-line @typescript-eslint/naming-convention, no-underscore-dangle
  const __dirname = dirname(fileURLToPath(import.meta.url))

  buildNumberBuffer = fs.readFileSync(`${__dirname}/../BUILD`)
} catch (e) {
  console.error(`Error reading buildNumber file: ${e}`)
}
const buildNumber = buildNumberBuffer.toString().trim()
const buildString = buildNumber
  ? `build [${buildNumber}](https://github.com/thesis/valkyrie/commit/${buildNumber})`
  : "unknown build"

function sendReleaseNotification(robot: Robot) {
  const alertRoom = process.env.RELEASE_NOTIFICATION_ROOM
  if (alertRoom !== undefined) {
    robot.messageRoom(alertRoom, `Released ${buildString}!`)
  }
}

export default function setUpCurrentBuild(robot: Robot) {
  sendReleaseNotification(robot)

  robot.respond(/current build/, (response) =>
    response.send(`I'm on ${buildString}!`),
  )
}
