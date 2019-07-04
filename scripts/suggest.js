// Description:
//   Allows a chat user to post a suggestion for hubot features or enhancements
//
// Dependencies:
//
//
// Configuration:
//  RELEASE_NOTIFICATION_ROOM - id of flow to use for suggestion posts if robot name not found in TARGET_FLOW_PER_ROBOT
//  FLOWDOCK_ORGANIZATION_NAME - name of flowdock organization for constructing urls
//
// Commands:
//   hubot suggest <your idea here> - Posts a message to the main hubot flow, with content of the suggestion & name of the user, and replies to the command with a link to that flow

const util = require("util")

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

const FLOW_URL = `https://www.flowdock.com/app/{orgName}/{flowName}`
const THREAD_URL = `https://www.flowdock.com/app/{orgName}/{flowName}/threads/{threadId}`

module.exports = function(robot) {
  const targetFlowName =
    TARGET_FLOW_PER_ROBOT[robot.name] ||
    getRoomNameFromId(process.env["RELEASE_NOTIFICATION_ROOM"])
  const targetFlowId = TARGET_FLOW_PER_ROBOT[robot.name]
    ? getRoomIdFromName(robot, targetFlowName)
    : process.env["RELEASE_NOTIFICATION_ROOM"]

  robot.respond(/suggest ?((?:.|\s)*)$/i, res => {
    try {
      let user = res.message.user
      let userSuggestion = res.match[1]

      let targetFlowLink = FLOW_URL.replace(
        /{orgName}/,
        process.env["FLOWDOCK_ORGANIZATION_NAME"].toLowerCase(),
      ).replace(/{flowName}/, targetFlowName.toLowerCase())
      let redirectToTargetFlowMessage = `You can try again from a public flow, or join us in [${targetFlowName}](${targetFlowLink}) and chat with us about your idea there.`

      if (typeof res.message.room === "undefined") {
        return res.send(
          `Sorry, this command only works from flows, not DMs.\n${redirectToTargetFlowMessage}`,
        )
      }

      let flowData = getRoomInfoFromIdOrName(robot, res.message.room)
      if (flowData.access_mode === "invitation") {
        return res.send(
          `Sorry, this command only works from public flows, to protect the privacy of your invite-only flow.\n\n${redirectToTargetFlowMessage}`,
        )
      }

      if (!userSuggestion) {
        res.send(
          "Yes? I'm listening.... \n(Please try again: this time add your suggestion after the `suggest` command).",
        )
        return
      }

      let sourceFlow = getRoomNameFromId(robot, res.message.room)
      let sourceThreadId = res.message.metadata.thread_id
      let sourceThreadLink = THREAD_URL.replace(
        /{orgName}/,
        process.env["FLOWDOCK_ORGANIZATION_NAME"].toLowerCase(),
      )
        .replace(/{flowName}/, sourceFlow.toLowerCase())
        .replace(/{threadId}/, sourceThreadId)

      // post suggestion message & related info targetFlowName
      let formattedSuggestion = `@${res.message.user.name} just made a #suggestion in ${sourceFlow}:\n>${userSuggestion}\n\nSee [original thread](${sourceThreadLink}).`
      let envelope = {
        room: targetFlowId,
      }

      // TODO: get link to this post
      robot.send(envelope, formattedSuggestion)

      // then respond in source suggestion thread
      // TODO: add link to post in TARGET_FLOW
      res.send(
        `Thanks for the suggestion! We'll be discussing it further in [${targetFlowName}](${targetFlowLink}), feel free to join us there.`,
      )
    } catch (err) {
      robot.logger.error(
        `Failed to send user suggestion to target flow: ${util.inspect(err)}`,
      )
      return res.send(
        `Something went wrong trying to post your suggestion in [${targetFlowName}](${targetFlowLink}) - please pop over there and let us know!`,
      )
    }
  })
}
