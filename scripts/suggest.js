// Description:
//   Allows a chat user to post a suggestion for hubot features or enhancements
//
// Dependencies:
//
//
// Configuration:
//  SUGGESTION_ALERT_ROOM - name of flow in which to posts suggestions
//  HUBOT_FLOWDOCK_API_TOKEN - Api token for hubot to post messages on Flowdock via API instead of using adapter
//
// Commands:
//   hubot suggest <your idea here> - Posts a message to the main hubot flow, with content of the suggestion & name of the user, and replies to the command with a link to that flow

const util = require("util")

const {
  fetchConfigOrReportIssue,
  fetchRoomInfoOrReportIssue,
} = require("../lib/config")

const flowdock = require("../lib/flowdock")
const {
  getRoomNameFromId,
  getRoomInfoFromIdOrName,
  isRoomInviteOnly,
} = require("../lib/flowdock-util")

const FLOWDOCK_SESSION = new flowdock.BasicAuthSession(
  process.env["HUBOT_FLOWDOCK_API_TOKEN"],
)

module.exports = function(robot) {
  const alertRoomName = fetchConfigOrReportIssue(robot, "SUGGESTION_ALERT_ROOM")
  const alertRoom = fetchRoomInfoOrReportIssue(robot, alertRoomName)
  // used for both alertRoomLink, used in redirect messages, and in
  // thread links used in reply to user suggestion
  let alertRoomPath = ""
  // used for redirect messages
  let alertRoomReference = ""

  if (!alertRoom) {
    // this is local dev (the config utilities would have thrown if it weren't)
    // fall back to a reference to the room name instead of a link
    alertRoomReference = `${alertRoomName || "Shell"}`
  } else {
    alertRoomPath = robot.adapter.flowPath(alertRoom)

    let alertRoomLink = `${flowdock.URLs.flow}`.replace(
      /{flowPath}/,
      alertRoomPath,
    )

    alertRoomReference = `[${alertRoomName}](${alertRoomLink})`
  }

  robot.respond(/suggest ?((?:.|\s)*)$/i, async res => {
    try {
      let user = res.message.user
      let userSuggestion = res.match[1]

      let redirectToSuggestionAlertRoomMessage = `You can try again from a public flow, or join us in ${alertRoomReference} and chat with us about your idea there.`

      if (typeof res.message.room === "undefined") {
        res.send(
          `Sorry, this command only works from flows, not DMs.\n${redirectToSuggestionAlertRoomMessage}`,
        )
        return
      }

      if (
        isRoomInviteOnly(robot.adapter, robot.adapterName, res.message.room)
      ) {
        res.send(
          `Sorry, this command only works from public flows, to protect the privacy of your invite-only flow.\n\n${redirectToSuggestionAlertRoomMessage}`,
        )
        return
      }

      if (!userSuggestion) {
        res.send(
          "Yes? I'm listening.... \n(Please try again: this time add your suggestion after the `suggest` command).",
        )
        return
      }

      let sourceFlowName = ""
      let originalThreadReference = ""

      let sourceFlow = getRoomInfoFromIdOrName(robot.adapter, res.message.room)
      if (!sourceFlow) {
        // this is probably local dev in the shell adapter
        // let's log an error in case this ever happens in prod
        robot.logger.error(
          `Could not get room name from res.message.room: ${res.message.room}.`,
        )
        // and fall back to a reference to the room instead of a link
        sourceFlowName = res.message.room
        originalThreadReference = `Refer to original thread in: ${sourceFlowName}.`
      } else {
        sourceFlowName = sourceFlow.name
        let sourceThreadId = res.message.metadata.thread_id
        let sourceThreadPath = robot.adapter.flowPath(sourceFlow)
        let sourceThreadLink = `${flowdock.URLs.thread}`
          .replace(/{flowPath}/, sourceThreadPath)
          .replace(/{threadId}/, sourceThreadId)
        originalThreadReference = `See [original thread](${sourceThreadLink}).`
      }

      // post suggestion message & related info
      let formattedSuggestion = `@${res.message.user.name} just made a #suggestion in ${sourceFlowName}:\n>${userSuggestion}\n\n${originalThreadReference}`

      if (!alertRoom) {
        // this is probably local dev in the shell adapter
        // let's log an error in case this ever happens in prod
        robot.logger.error(
          `Could not get room name for: ${alertRoom}. Falling back to posting message without link to thread in alert room.`,
        )
        // and post without the API (will that work w/o flow id?)
        robot.send({ room: alertRoomName }, formattedSuggestion)
        return
      }

      let postResponse = await FLOWDOCK_SESSION.postMessage(
        formattedSuggestion,
        alertRoom.id,
      )
      var alertThreadId = postResponse.data.thread_id
      if (!alertThreadId) {
        throw new Error(
          `Did not get thread id from post message response: ${util.inspect(
            postResponse,
          )}`,
        )
      }

      // construct formatted thread link
      let alertThreadReference = `[${alertRoomName}](${flowdock.URLs.thread})`
        .replace(/{flowPath}/, alertRoomPath)
        .replace(/{threadId}/, threadId)
      // then respond in source suggestion thread with formatted thread link
      res.send(
        `Thanks for the suggestion! We'll be discussing it further in ${alertThreadReference}, feel free to join us there.`,
      )
    } catch (err) {
      robot.logger.error(
        `Failed to send user suggestion to target flow: ${util.inspect(err)}`,
      )
      res.send(
        `Something went wrong trying to post your suggestion. Please ask your friendly human robot-tender to look into it.`,
      )
    }
  })
}
