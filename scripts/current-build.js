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

let fs = require("fs")

let buildNumberBuffer = ""
try {
    buildNumberBuffer = fs.readFileSync(`${__dirname}/../BUILD`)
} catch (e) {
    console.error("Error reading buildNumber file: " + e)
}
let buildNumber = buildNumberBuffer.toString().trim()
let buildString =
    buildNumber ?
        `build [${buildNumber}](https://circle-ci.com/gh/cardforcoin/heimdall/${buildNumber})` :
        `unknown build`

let releaseNotificationRoom = process.env['RELEASE_NOTIFICATION_ROOM']

function sendReleaseNotification(robot) {
    if (releaseNotificationRoom) {
        robot.send({
            user: '',
            room: releaseNotificationRoom
        }, `Released ${buildString}!`)
    }
}

function attachToStream(fn) {
    setTimeout(() => {
        if (! fn()) {
            attachToStream(fn)
        }
    })
}

module.exports = function (robot) {
    // Adjust for Flowdock adapter dispatching the connected event too soon.
    if (robot.adapter.bot && robot.adapter.bot.flows) {
        robot.adapter.bot.flows(() => {
            attachToStream(() => {
                if (robot.adapter.stream) {
                    robot.adapter.stream.on(
                        'connected',
                        () => sendReleaseNotification(robot.adapter)
                    )
                    return true
                } else {
                    return false
                }
            })
        })
    } else {
        sendReleaseNotification(robot)
    }

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
