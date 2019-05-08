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

var ALLOWED_ROOMS, RESTRICTED_COMMANDS;

RESTRICTED_COMMANDS = [
  'badgers',
  'dad-jokes',
  'pod-bay-doors'
]; // String that matches the listener ID

ALLOWED_ROOMS = [
  '8dd97a6a-d6f0-4352-be7d-388d9afeea9f' //playground
]; // String that matches the room ID

module.exports = function(robot) {
  robot.listenerMiddleware(function(context, next, done) {
    if (RESTRICTED_COMMANDS.indexOf(context.listener.options.id) >= 0) {
      if (ALLOWED_ROOMS.indexOf(context.response.message.room) >= 0) {
        // User is allowed access to this command
        next();
      } else {
        // Restricted command, but flow isn't in whitelist
        context.response.reply(`I'm sorry, but that command doesn't work here.`);
        done();
      }

    } else {
      next();
    }
  })
}
