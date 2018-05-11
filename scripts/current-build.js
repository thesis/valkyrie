let fs = require("fs")

// Description:
//   Returns the current deployed build.
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

// TODO Announce new build to Bifrost flow, configured.
let releaseNotificationRoom = process.env['RELEASE_NOTIFICATION_ROOM']

module.exports = function (robot) {
    robot.respond(/flows/, (response) =>
        if (robot.adapter.flows != null) {
            response.send(JSON.stringify(robot.adapter.flows))
        } else {
            response.send('Not using flowdock.')
        })

    robot.respond(/current build/, (response) =>
        response.send(`I'm on build [${buildNumber}](https://circle-ci.com/gh/cardforcoin/heimdall/${buildNumber})!`))
}