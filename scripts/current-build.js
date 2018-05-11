let fs = require("fs")

// Description:
//   Returns the current deployed build.
//
// Configuration:
//   RELEASE_NOTIFICATION_ROOM - Id of the room for release notifications.
//
// Dependencies:
//   None
//
// Commands:
//   hubot current build
//
// Author:
//   shadowfiend

let buildNumberBuffer = ""
try {
    buildNumberBuffer = fs.readFileSync(`${__dirname}/../BUILD`)
} catch (e) {
    console.error("Error reading buildNumber file: " + e)
}
let buildNumber = buildNumberBuffer.toString().trim()
let buildString = `build [${buildNumber}](https://circle-ci.com/gh/cardforcoin/heimdall/${buildNumber})`

let releaseNotificationRoom = process.env['RELEASE_NOTIFICATION_ROOM']

module.exports = function (robot) {
    robot.logger.info(`Will be sending release notification to [${releaseNotificationRoom}].`)
    robot.on('connected', () => {
        robot.logger.info(`Connected and sending release notification to [${releaseNotificationRoom}].`)
        if (releaseNotificationRoom) {
            robot.messageRoom(releaseNotificationRoom, `Released ${buildString}!`)
        }
    })

    robot.respond(/flows/, (response) => {
        if (robot.adapter.flows != null) {
            response.send(
                robot.adapter.flows.map((flow) => ` - ${flow.name}: ${flow.id}`).join("\n")
            )
        } else {
            response.send('Not using flowdock.')
        }
    })

    robot.respond(/current build/, (response) =>
        response.send(`I'm on ${buildString}!`))
}
