// Description:
//
// Recognizes any command passed by the listener, immediately followed by
//  "help", and re-sends the message to the robot in the correct syntax to
//  trigger help.
//
// Configuration: Listener middleware executes in the order in which it loads.
//   If you have other listener middleware that must run in a specific order
//   relative to this one, please rename your files accordingly to force them
//   to load in the correct order!
//   https://hubot.github.com/docs/scripting/#execution-process-and-api
//
// Commands:
//   hubot <command> help - redirects to `hubot help <command>`
//
// Author:
//   kb0rg

const { TextMessage } = require("hubot")

module.exports = function(robot) {
  robot.listenerMiddleware(function(context, next, done) {
    robot.logger.debug(
      `\n >>>>>>>>>>>>> This is the HELP ALIAS listenerMiddleware`,
    )
    if (
      context.response.match[1] &&
      context.response.match[1].trim().toLowerCase() === "help"
    ) {
      robot.logger.debug(`>>>> REDIRECTING TO HELP`)
      // Recreate the message with the command order flipped, send to robot.
      let flippedHelpRequest = `help ${context.response.match[0]}`
      let messageToRobot = new TextMessage(
        context.response.envelope.user,
        flippedHelpRequest,
      )
      // TODO: Add metadata to message, if present.
      robot.adapter.receive(messageToRobot)
      // TODO: maybe make sure no one is calling "help help" because you know SOMEONE will try
      done()
    } else {
      next()
    }
  })
}
