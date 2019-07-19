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
}
