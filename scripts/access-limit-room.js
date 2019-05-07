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

var ALLOWED_ROOMS, RESTRICTED_COMMANDS,
  indexOf = [].indexOf;

RESTRICTED_COMMANDS = [
  'badgers',
  'pod-bay-doors' // String that matches the listener ID
];

ALLOWED_ROOMS = ['playground']; // String that matches the room name or ID

module.exports = function(robot) {
  return robot.listenerMiddleware(function(context, next, done) {
    var ref, ref1;
    if (ref = context.listener.options.id, indexOf.call(RESTRICTED_COMMANDS, ref) >= 0) {
      if (ref1 = context.response.message.room, indexOf.call(ALLOWED_ROOMS, ref1) >= 0) {
        // User is allowed access to this command
        return next();
      } else {
        // Restricted command, but flow isn't in whitelist
        context.response.reply(`I'm sorry, @${context.response.message.user.name}, but that command doesn't work here.`);
        return done();
      }
    }
  })
}