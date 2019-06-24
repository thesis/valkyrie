// Description:
//   Allows a chat user to post a suggestion for hubot features or enhancements
//
// Dependencies:
//
//
// Configuration:
//  TARGET_FLOW - string - name of the flow in which to post suggestions
//  TARGET_FLOW_PER_ROBOT - dict - collection of robot name: flow name to determine TARGET_FLOW
//  DEFAULT_TARGET_FLOW - flow name to use if robot name not found in TARGET_FLOW_PER_ROBOT
//
// Commands:
//   hubot suggest - Posts a message to the specifed flow with the content of
//   the suggestion and the name of the user who suggested it, replies to the
//   command with a link to that post

// NOTE: robot.name uses lowercase
const TARGET_FLOW_PER_ROBOT = {
  valkyrie: "Playground",
  heimdall: "Bifrost",
}
const DEFAULT_TARGET_FLOW = "Bifrost"

module.exports = function(robot) {
  const TARGET_FLOW = TARGET_FLOW_PER_ROBOT[robot.name] || DEFAULT_TARGET_FLOW
  robot.respond(/suggest/, res => {
    // get username of poster
    // post suggestion message, username to TARGET_FLOW
    // get link to new suggestion post in TARGET_FLOW
    // respond in original suggestion thread with link to new post in TARGET_FLOW
    res.send(`testing target flow: ${TARGET_FLOW}`)
  })
}
