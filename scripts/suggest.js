// Description:
//   Allows a chat user to post a suggestion for hubot features or enhancements
//
// Dependencies:
//
//
// Configuration:
//  TARGET_FLOW_PER_ROBOT - dict - collection of robot name: flow name to determine TARGET_FLOW
//  DEFAULT_TARGET_FLOW - flow name to use if robot name not found in TARGET_FLOW_PER_ROBOT
//
// Commands:
//   hubot suggest - Posts a message to the main hubot flow, with content of the suggestion & name of the user, and replies to the command with a link to that flow

const {
  getRoomIdFromName,
  getRoomNameFromId,
  getRoomInfoFromIdOrName,
} = require("../lib/flowdock-util")

// NB: Capitalilzed names are for display. robot.name uses lowercase
const TARGET_FLOW_PER_ROBOT = {
  valkyrie: "Playground",
  heimdall: "Bifrost",
}
const DEFAULT_TARGET_FLOW = "Bifrost"
const FLOW_URL = `https://www.flowdock.com/app/cardforcoin/{flowName}`
const THREAD_URL = `https://www.flowdock.com/app/cardforcoin/{flowName}/threads/{threadId}`

module.exports = function(robot) {
  const targetFlowName =
    TARGET_FLOW_PER_ROBOT[robot.name] || DEFAULT_TARGET_FLOW
  const targetFlowId = getRoomIdFromName(robot, targetFlowName)

  robot.respond(/suggest ?((?:.|\s)*)$/i, res => {
    try {
      let user = res.message.user
      let userSuggestion = res.match[1]

      if (typeof res.message.room === "undefined") {
        return res.send("Sorry, this command only works from flows, not DMs")
      }

      let flowData = getRoomInfoFromIdOrName(robot, res.message.room)
      if (flowData.access_mode === "invitation") {
        return res.send(
          "Sorry, this command only works from public flows, to protect the privacy of your invite-only flow",
        )
      }

      if (!userSuggestion) {
        res.send(
          "Yes? I'm listening.... \n(Please try again: this time add your suggestion after the `suggest` command)",
        )
        return
      }

      let sourceFlow = getRoomNameFromId(robot, res.message.room)
      let sourceThreadId = res.message.metadata.thread_id
      let sourceThreadLink = THREAD_URL.replace(
        /{flowName}/,
        sourceFlow.toLowerCase(),
      ).replace(/{threadId}/, sourceThreadId)

      // post suggestion message & related info targetFlowName
      let formattedSuggestion = `@${res.message.user.name} just made a suggestion in ${sourceFlow}:\n>${userSuggestion}\n\nSee [original thread](${sourceThreadLink})`
      let envelope = {
        user: "",
        room: targetFlowId,
      }
      // TODO: get link to this post
      robot.send(envelope, formattedSuggestion)

      let targetFlowLink = FLOW_URL.replace(
        /{flowName}/,
        targetFlowName.toLowerCase(),
      )
      // then respond in source suggestion thread
      // TODO: add link to post in TARGET_FLOW
      res.send(
        `Thanks for the suggestion! We'll be discussing it further in [${targetFlowName}](${targetFlowLink}), feel free to join us there.`,
      )
    } catch (error) {
      console.log(`WTF?????\n${error}`)
      robot.logger.error(
        `Failed to send user suggestion to target flow: `,
        error,
      )
      return res.send(
        `Something went wrong trying to post your suggestion in [${targetFlowName}](${targetFlowLink}) - please pop over there and let us know!`,
      )
    }
  })
}
