// Description:
//   A collection of utilities to get and set information in hubot's brain,
//   related to flowdock usage.
//
// Configuration:
//
// Commands:
//   hubot flows
//
// Author:
//   shadowfiend
//   kb0rg

module.exports = function(robot) {
  robot.respond(/flows/, response => {
    if (robot.adapter.flows != null) {
      response.send(
        robot.adapter.flows
          .map(flow => ` - ${flow.name}: ${flow.id}`)
          .join("\n"),
      )
    } else {
      response.send("Not using flowdock.")
    }
  })

  robot.respond(/users (robot|flowdock)/i, response => {
    let dataSource = response.match[1].toLowerCase()
    if (dataSource === "flowdock") {
      // TODO: get users from Flowdock API
      if (robot.adapterName.toLowerCase() === "flowdock") {
        return response.send(
          "TODO: get users from Flowdock API (turns out the adapter just gets it from the brain anyway)\n:shrug:",
        )
      } else {
        return response.send("Not using flowdock.")
      }
    }

    if (robot.brain.users() != null) {
      return response.send(
        Object.values(robot.brain.users())
          .map(user => ` - ${user.name}: ${user.id}`)
          .join("\n"),
      )
    }
  })

  robot.respond(/reconnect ?((?:.|\s)*)$/i, response => {
    let reason = response.match[1]
    if (!reason) {
      return response.send(
        "Please provide a reason for the reconnect (for logging purposes)",
      )
    }
    if (robot.adapterName.toLowerCase() !== "flowdock") {
      return response.send(
        `Not using flowdock. robot.adapterName.toLowerCase(): ${robot.adapterName.toLowerCase()}`,
      )
    }
    try {
      response.send("Trying to reconnect... please hold.")
      robot.logger.info(
        `Starting reconnect by request of user: ${response.message.user.name}, because: ${reason}.`,
      )
      robot.adapter.reconnect(`Initiated by flowdock command: ${reason}`)
      return response.send("Reconnected")
    } catch (err) {
      robot.logger.error(
        `Attempted reconnect initiated by user ${response.message.user.name} failed : %o`,
        err,
      )
      return response.send(
        "Something went wrong trying to reconnect, please check the logs for error.",
      )
    }
  })
}
