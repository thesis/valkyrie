// Description:
//   Allows a chat user to post a suggestion for hubot features or enhancements
//
// Dependencies:
//
//
// Configuration:
//  SUGGESTION_ALERT_ROOM - name of flow to use for suggestion posts if robot name not found in TARGET_FLOW_PER_ROBOT
//
// Commands:
//   hubot suggest <your idea here> - Posts a message to the main hubot flow, with content of the suggestion & name of the user, and replies to the command with a link to that flow

const util = require("util")

const {
  fetchConfigOrReportIssue,
  fetchRoomIdOrReportIssue,
} = require("../lib/config")

const flowdock = require("../lib/flowdock")
const {
  getRoomNameFromId,
  getRoomInfoFromIdOrName,
} = require("../lib/flowdock-util")

module.exports = function(robot) {
  const suggestionAlertRoomName = fetchConfigOrReportIssue(
    robot,
    "SUGGESTION_ALERT_ROOM",
  )
  const suggestionAlertRoomId = fetchRoomIdOrReportIssue(
    robot,
    suggestionAlertRoomName,
  )
  let suggestionAlertRoomReference = ""

  if (!robot.adapter.flowPath) {
    // this is local dev (the config utilities would have thrown if it weren't)
    // fall back to a reference to the room name instead of a link
    suggestionAlertRoomReference = `${suggestionAlertRoomName || "Shell"}`
  } else {
    let suggestionAlertRoom = getRoomInfoFromIdOrName(
      robot.adapter,
      suggestionAlertRoomName,
    )
    let suggestionAlertRoomLink = `${
      flowdock.APP_BASE_URL
    }/${robot.adapter.flowPath(suggestionAlertRoom)}`

    suggestionAlertRoomReference = `[${suggestionAlertRoomName}](${suggestionAlertRoomLink})`
  }

  robot.respond(/suggest ?((?:.|\s)*)$/i, res => {
    try {
      let user = res.message.user
      let userSuggestion = res.match[1]

      let redirectToSuggestionAlertRoomMessage = `You can try again from a public flow, or join us in ${suggestionAlertRoomReference} and chat with us about your idea there.`

      if (typeof res.message.room === "undefined") {
        return res.send(
          `Sorry, this command only works from flows, not DMs.\n${redirectToSuggestionAlertRoomMessage}`,
        )
      }

      let flowData = getRoomInfoFromIdOrName(robot.adapter, res.message.room)
      if (flowData && flowData.access_mode === "invitation") {
        return res.send(
          `Sorry, this command only works from public flows, to protect the privacy of your invite-only flow.\n\n${redirectToSuggestionAlertRoomMessage}`,
        )
      }

      if (!userSuggestion) {
        res.send(
          "Yes? I'm listening.... \n(Please try again: this time add your suggestion after the `suggest` command).",
        )
        return
      }

      let sourceFlowName = getRoomNameFromId(robot.adapter, res.message.room)
      let originalThreadReference = ""

      if (!robot.adapter.flowPath) {
        // this is probably local dev, but no special handling needed
        // let's log an error in case this ever happens in prod
        robot.logger.info(
          `Could not get room name from res.message.room: ${res.message.room}.`,
        )
        // and fall back to a reference to the room instead of a link
        sourceFlowName = res.message.room
        originalThreadReference = `Refer to original thread in: ${res.message.room}.`
      } else {
        let sourceThreadId = res.message.metadata.thread_id
        let sourceFlow = getRoomInfoFromIdOrName(robot.adapter, sourceFlowName)
        let sourceThreadPath = `${robot.adapter.flowPath(
          sourceFlow,
        )}/${sourceThreadId}`
        let sourceThreadLink = `${flowdock.APP_BASE_URL}/${sourceThreadPath}`
        originalThreadReference = `See [original thread](${sourceThreadLink}).`
      }

      // post suggestion message & related info
      let formattedSuggestion = `@${res.message.user.name} just made a #suggestion in ${sourceFlowName}:\n>${userSuggestion}\n\n${originalThreadReference}`
      let envelope = {
        room: suggestionAlertRoomId,
      }

      // TODO: get link to this post
      robot.send(envelope, formattedSuggestion)

      // then respond in source suggestion thread
      // TODO: add link to post in TARGET_FLOW
      res.send(
        `Thanks for the suggestion! We'll be discussing it further in ${suggestionAlertRoomReference}, feel free to join us there.`,
      )
    } catch (err) {
      robot.logger.error(
        `Failed to send user suggestion to target flow: ${util.inspect(err)}`,
      )
      return res.send(
        `Something went wrong trying to post your suggestion. Please ask your friendly human robot-tender to look into it.`,
      )
    }
  })
}
