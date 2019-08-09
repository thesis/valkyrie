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
  fetchRoomIdOrReportIssue,
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
  const suggestionAlertRoomName = fetchConfigOrReportIssue(
    robot,
    "SUGGESTION_ALERT_ROOM",
  )
  const suggestionAlertRoomId = fetchRoomIdOrReportIssue(
    robot,
    suggestionAlertRoomName,
  )
  let suggestionAlertRoomReference = ""

  // TODO: reformat or move this into the command block: since we're switching
  // to posting a direct thread link, need to get threadId when suggestion is posted
  // Note we may still need this if keeping redirectToSuggestionAlertRoomMessage
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

      if (
        isRoomInviteOnly(robot.adapter, robot.adapterName, res.message.room)
      ) {
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

      let sourceFlowName = ""
      let originalThreadReference = ""

      let sourceFlow = getRoomInfoFromIdOrName(robot.adapter, res.message.room)
      // TODO: this should maybe throw now, since posting via API requires a flowId
      if (!sourceFlow) {
        // this is probably local dev, but no special handling needed
        // let's log an error in case this ever happens in prod
        robot.logger.error(
          `Could not get room name from res.message.room: ${res.message.room}.`,
        )
        // and fall back to a reference to the room instead of a link
        sourceFlowName = res.message.room
        originalThreadReference = `Refer to original thread in: ${res.message.room}.`
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
      let envelope = {
        room: suggestionAlertRoomId,
      }

      let postResponse = FLOWDOCK_SESSION.postMessage(
        formattedSuggestion,
        suggestionAlertRoomId,
      )
        .then(response => {
          var alertThreadId = response.data.thread_id
          if (alertThreadId) {
            return alertThreadId
          } else {
            robot.logger.error(
              `Did not get thread id from post message response: %o`,
              response,
            )
            throw new Error("Did not get thread id from post message response")
          }
        })
        .then(threadId => {
          // TODO reconstruct suggestionAlertRoomReference with threadId
          // then respond in source suggestion thread with formatted thread link
          return res.send(
            `Thanks for the suggestion! We'll be discussing it further in ${suggestionAlertRoomReference}, feel free to join us there.`,
          )
        })
        .catch(err => {
          robot.logger.error(`Suggestion failed to post: ${err.message}`)
          // TODO: bubble this error to the next catch instead of returning?
          return res.send(`Something went wrong sending your suggestion.`)
        })

      // TODO: does this still work or does it all need to be `then()` blocks?
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
