// Description:
//   Configures access control to restrict some commands to specific rooms.
//
//   This is mostly a direct lift from example code in the hubot docs:
//   https://hubot.github.com/docs/patterns/#restricting-access-to-commands
//   Modified to be room-based rather than user-based, and converted to js
//
// Configuration:
//
//
// Commands:
//   None
//
// Author:
//   kb0rg

var ALLOWED_ROOMS,
  ALLOWED_BOTS,
  BOT_RESTICTED_COMMANDS,
  ROOM_RESTRICTED_COMMANDS

BOT_RESTICTED_COMMANDS = ["reload-scripts.reload"] // String that matches the listener ID
ALLOWED_BOTS = ["valkyrie"]

ROOM_RESTRICTED_COMMANDS = ["badgers", "pod-bay-doors", "schedule"] // String that matches the listener ID
ALLOWED_ROOMS = [
  "8cf540e9-9727-4a75-82d1-843575e61f1b", //bifrost
  "8dd97a6a-d6f0-4352-be7d-388d9afeea9f", //playground
] // String that matches the room ID

module.exports = function(robot) {
  robot.listenerMiddleware(function(context, next, done) {
    if (BOT_RESTICTED_COMMANDS.indexOf(context.listener.options.id) >= 0) {
      if (ALLOWED_BOTS.indexOf(robot.name) >= 0) {
        // Bot is allowed access to this command
        next()
      } else {
        // Restricted command, and bot isn't in whitelist
        context.response.reply(`Sorry, only *some* bots are allowed to do that`)
        done()
      }
    } else {
      if (ROOM_RESTRICTED_COMMANDS.indexOf(context.listener.options.id) >= 0) {
        if (ALLOWED_ROOMS.indexOf(context.response.message.room) >= 0) {
          // User is allowed access to this command
          next()
        } else {
          if (robot.adapterName == "shell") {
            // we're in the shell adapter: allow the command for local testing
            next()
          } else {
            // Restricted command, and flow isn't in whitelist
            context.response.reply(
              `I'm sorry, but that command doesn't work here.`,
            )
            done()
          }
        }
      } else {
        next()
      }
    }
  })
}
