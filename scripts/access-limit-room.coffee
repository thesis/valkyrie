RESTRICTED_COMMANDS = [
  'badgers', 'pod-bay-doors', # String that matches the listener ID
]

ALLOWED_ROOMS = [
  'playground' # String that matches the room name or ID
]

module.exports = (robot) ->
  robot.listenerMiddleware (context, next, done) ->
    if context.listener.options.id in RESTRICTED_COMMANDS
      if context.response.message.room in ALLOWED_ROOMS
        # User is allowed access to this command
        next()
      else
        # Restricted command, but flow isn't in whitelist
        context.response.reply "I'm sorry, @#{context.response.message.user.name}, but that command doesn't work here."
        done()
    else
      # This is not a restricted command; allow everywhere
      next()