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
  robot.respond(/suggest ?((?:.|\s)*)$/i, res => {
    let user = res.message.user

    // TODO: get source room ID, and let below be source room Name for message only
    let sourceRoom = res.message.room || `Direct Message with ${robot.name}`
    let comment = res.match[1] // optional name of room specified in msg

    if (!comment) {
      res.send(
        "Yes? I'm listening.... \n(Please try again: this time add your suggestion after the `suggest` command)",
      )
      return
    }

    // post suggestion message, username to TARGET_FLOW
    let envelope = {
      user: user,
      room: TARGET_FLOW,
    }
    // TODO: include link to source thread in message
    let message = `testing suggestion sent by ${user.name} from ${sourceRoom}: \n>${comment}`
    // TODO: get link to this post
    robot.messageRoom(TARGET_FLOW, message)

    // then respond in original suggestion thread with link to new post in TARGET_FLOW
  })
}
