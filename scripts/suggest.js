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

const flowdock = require("../lib/flowdock")
const {
  getRoomNameFromId,
  getRoomInfoFromIdOrName,
} = require("../lib/flowdock-util")

module.exports = function(robot) {
  robot.respond(/suggest ?((?:.|\s)*)$/i, res => {
    let fallbackErrorMessage = `Please ask your friendly human robot-tender to look into it.`

    if (
      !process.env["RELEASE_NOTIFICATION_ROOM"] ||
      !process.env["FLOWDOCK_ORGANIZATION_NAME"]
    ) {
      robot.logger.error(
        `Missing essential configuration for the suggest command. Check your environment variables for RELEASE_NOTIFICATION_ROOM and FLOWDOCK_ORGANIZATION_NAME.`,
      )
      res.send(
        `Sorry, something isn't set up correctly for this command to work. ${fallbackErrorMessage}`,
      )
      return
    }

    try {
      // TODO: clean this up when we refactor all occurances of RELEASE_NOTIFICATION_ROOM to use name instead of ID
      const suggestionAlertRoom = getRoomInfoFromIdOrName(
        robot,
        process.env["RELEASE_NOTIFICATION_ROOM"],
      )
      let suggestionAlertRoomName = ""
      let suggestionAlertRoomId = ""
      let suggestionAlertRoomReference = ""

      if (typeof suggestionAlertRoom == "undefined" || !suggestionAlertRoom) {
        // this is probably local dev, but let's log an error in case this ever happens in prod
        releaseNotificationRoom = process.env["RELEASE_NOTIFICATION_ROOM"]
        robot.logger.info(
          `Could not get flow data for: ${releaseNotificationRoom}.`,
        )
        // and fall back to a reference to the room name instead of a link
        suggestionAlertRoomReference = `${releaseNotificationRoom}`
      } else {
        suggestionAlertRoomName = suggestionAlertRoom.name
        let suggestionAlertRoomLink = flowdock.URLs.flow
          .replace(
            /{orgName}/,
            process.env["FLOWDOCK_ORGANIZATION_NAME"].toLowerCase(),
          )
          .replace(/{flowName}/, suggestionAlertRoomName.toLowerCase())
        suggestionAlertRoomReference = `[${suggestionAlertRoomName}](${suggestionAlertRoomLink})`

        suggestionAlertRoomId = suggestionAlertRoom.id
      }

      let user = res.message.user
      let userSuggestion = res.match[1]

      let redirectToSuggestionAlertRoomMessage = `You can try again from a public flow, or join us in ${suggestionAlertRoomReference} and chat with us about your idea there.`

      if (typeof res.message.room === "undefined") {
        return res.send(
          `Sorry, this command only works from flows, not DMs.\n${redirectToSuggestionAlertRoomMessage}`,
        )
      }

      let flowData = getRoomInfoFromIdOrName(robot, res.message.room)
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

      let sourceFlow = getRoomNameFromId(robot, res.message.room)
      let originalThreadReference = ""

      if (typeof sourceFlow === "undefined" || !sourceFlow) {
        // this is probably local dev, but let's log an error in case this ever happens in prod
        robot.logger.info(
          `Could not get room name from res.message.room: ${res.message.room}.`,
        )
        // and fall back to a reference to the room instead of a link
        sourceFlow = res.message.room
        originalThreadReference = `Refer to original thread in: ${res.message.room}.`
      } else {
        let sourceThreadId = res.message.metadata.thread_id
        let sourceThreadLink = flowdock.URLs.thread
          .replace(
            /{orgName}/,
            process.env["FLOWDOCK_ORGANIZATION_NAME"].toLowerCase(),
          )
          .replace(/{flowName}/, sourceFlow.toLowerCase())
          .replace(/{threadId}/, sourceThreadId)
        originalThreadReference = `See [original thread](${sourceThreadLink}).`
      }

      // post suggestion message & related info
      let formattedSuggestion = `@${res.message.user.name} just made a #suggestion in ${sourceFlow}:\n>${userSuggestion}\n\n${originalThreadReference}`
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
        `Something went wrong trying to post your suggestion. ${fallbackErrorMessage}`,
      )
    }
  })
}
