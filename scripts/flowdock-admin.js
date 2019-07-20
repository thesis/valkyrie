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

const { notUsingFlowdock } = require("../lib/flowdock-util")

module.exports = function(robot) {
  robot.respond(/flows/, response => {
    if (notUsingFlowdock(robot.adapter, response)) {
      return
    }
    if (robot.adapter.flows != null) {
      response.send(
        robot.adapter.flows
          .map(flow => ` - ${flow.name}: ${flow.id}`)
          .join("\n"),
      )
    } else {
      response.send("No flows have been joined.")
    }
  })

  robot.respond(/users (robot|flowdock)/i, response => {
    let dataSource = response.match[1].toLowerCase()
    if (dataSource === "flowdock") {
      if (notUsingFlowdock(robot.adapter, response)) {
        return
      }
      // TODO: get users from Flowdock API
      return response.send(
        "TODO: get users from Flowdock API (turns out the adapter just gets it from the brain anyway)\n:shrug:",
      )
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
    console.log(`ROBOT ADAPTER CLASS NAME?: %o`, robot.adapter.constructor.name)
    if (notUsingFlowdock(robot.adapter, response)) {
      return
    }
    let reason = response.match[1]
    if (!reason) {
      return response.send(
        "Please try again, providing a reason for the reconnect (for logging purposes)",
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
