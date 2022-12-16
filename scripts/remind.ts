// Description:
//   Create a reminder message
//
//   Lightly based on hubot-schedule by matsukaz <matsukaz@gmail.com>
//
// Dependencies:
//   "lodash"        : "^4.17.14",
//   "chrono-node"   : "^1.3.11",
//
// Commands:
//   hubot remind [me|team|here] <day or date in English> <message> - Create a reminder, in the current flow, that runs at a specific date and time, using regular English syntax to describe the date/time. See https://www.npmjs.com/package/chrono-node for examples of accepted date formats. Note: you CAN include a timezone in your request, but all times will be Displayed in UTC.
//   hubot reminder [cancel|del|delete|remove] <id> - Cancel the reminder for the specified id.
//   hubot reminder [upd|update] <id> <message> - Update the message for the reminder with the specified id.
//   hubot reminder list - List all reminders for the current flow or DM. NOTE all times are displayed in UTC.
//   hubot reminder list <flow> - List all reminders for the specified flow. NOTE all times are displayed in UTC.
//   hubot reminder list all - List all reminders for any public flows (reminders in DMs or invite-only flows are hidden from this list, except when called from a DM or private flow). NOTE all times are displayed in UTC.
//
// Author:
//   kb0rg
//

import * as chrono from "chrono-node"

import { Robot, TextMessage } from "hubot"
import { MatrixMessage } from "hubot-matrix"
import {
  getRoomIdFromName,
  robotIsInRoom,
  isRoomNonPublic,
  getPublicJoinedRoomIds,
} from "../lib/adapter-util"
import JobScheduler from "../lib/remind"
import {
  cancelScheduledJob,
  createScheduledJob,
  syncSchedules,
  updateScheduledJob,
} from "../lib/schedule-management"

import {
  CONFIG,
  isBlank,
  getScheduledJobList,
  formatJobsForListMessage,
} from "../lib/schedule-util"
import { MessageMetadata } from "../lib/scheduled-jobs"

const REMINDER_JOBS = {}
const REMINDER_KEY = "hubot_reminders"

module.exports = function setupRemind(robot: Robot) {
  robot.brain.once("loaded", () => {
    const jobScheduler = new JobScheduler(
      robot,
      robot.brain.get(REMINDER_KEY) ?? [],
    )

    robot.respond(/remind (me|team|here) ((?:.|\s)*)$/i, (msg) => {
      try {
        msg.reply(
          `Scheduled new job: ${JSON.stringify(
            jobScheduler.addJobFromMessageEnvelope(msg.envelope),
          )}`,
        )
      } catch (error) {
        robot.logger.error(
          `Error adding job for message "${msg.message.text}": ${error}.`,
          error instanceof Error ? error.stack : "",
        )
        msg.reply(
          "I couldn't quite figure out what you meant for me to do with that, sorry :(",
        )
      }
    })

    robot.respond(/reminder list(?: (all|.*))?/i, async (msg) => {
      let rooms
      let outputPrefix
      const targetRoom = msg.match[1]
      const roomId = msg.envelope.room // room command is called from
      let targetRoomId = null
      let output = ""
      const calledFromDm = typeof roomId === "undefined"

      // If targetRoom is specified, check whether list for is permitted.
      if (!isBlank(targetRoom) && targetRoom !== "all") {
        targetRoomId = getRoomIdFromName(robot.adapter, targetRoom)
        if (
          targetRoomId === undefined ||
          !(await robotIsInRoom(robot.adapter, targetRoomId))
        ) {
          msg.reply(
            `Sorry, I'm not in the ${targetRoom} flow - or maybe you mistyped?`,
          )
          return
        }
        if (targetRoomId && isRoomNonPublic(robot.adapter, targetRoomId)) {
          if (msg.message.user.room !== targetRoomId) {
            msg.reply(
              "Sorry, that's a private flow. I can only show jobs scheduled from that flow from within the flow.",
            )
            return
          }
        }
      }

      // only get DMs from user who called list, if user calls list from a DM
      const userIdForDMs = calledFromDm ? msg.message.user.id : null

      let calledFromPrivateRoom = false

      // Construct params for getting and formatting job list
      if (isBlank(targetRoom) || CONFIG.denyExternalControl === "1") {
        // If targetRoom is undefined or blank, show schedule for current room.
        // Room is ignored when HUBOT_SCHEDULE_DENY_EXTERNAL_CONTROL is set to 1
        rooms = [roomId]
      } else if (targetRoom === "all") {
        // Get list of public rooms.
        rooms = await getPublicJoinedRoomIds(robot.adapter)
        // If called from a private room, add to list.
        calledFromPrivateRoom = !calledFromDm // TODO check for invite status of room
        if (calledFromPrivateRoom) {
          rooms.push(roomId)
        }
      } else {
        // If targetRoom is specified, show jobs for that room.
        rooms = targetRoomId === null ? [] : [targetRoomId]
      }

      // Construct message string prefix
      outputPrefix = "Showing scheduled reminders for "
      if (isBlank(targetRoom) || CONFIG.denyExternalControl === "1") {
        outputPrefix += "THIS flow:\n"
      } else if (targetRoom === "all") {
        // If called from a private room, add to list.
        if (calledFromPrivateRoom) {
          outputPrefix += "THIS flow AND "
        }
        outputPrefix += "all public flows:\n"
      } else {
        // If targetRoom is specified, show jobs for that room if allowed.
        outputPrefix += `the ${targetRoom} flow:\n`
      }

      try {
        const [dateJobs] = getScheduledJobList(
          REMINDER_JOBS,
          rooms,
          userIdForDMs,
        )
        output = formatJobsForListMessage(robot.adapter, dateJobs, false)

        if (output.length) {
          output = `${outputPrefix}===\n${output}`
          msg.reply(output)
          return
        }
        msg.reply("No reminders have been scheduled")
        return
      } catch (error) {
        robot.logger.error(
          `Error getting or formatting reminder job list: ${
            error instanceof Error ? error.message : "(unknown error)"
          }\nFull error: %o`,
          error,
        )
        msg.reply("Something went wrong getting the reminder list.")
      }
    })

    robot.respond(/reminder (?:upd|update) (\d+)\s((?:.|\s)*)/i, (msg) => {
      try {
        const resp = updateScheduledJob(
          robot,
          REMINDER_JOBS,
          REMINDER_KEY,
          msg.message.text ?? "",
          msg.match[1],
          msg.match[2],
        )
        msg.reply(resp)
      } catch (error) {
        robot.logger.error(
          `updateScheduledJob Error: ${
            error instanceof Error ? error.message : "(unknown error)"
          }`,
        )
        msg.reply("Something went wrong updating this reminder.")
      }
    })

    robot.respond(/reminder (?:del|delete|remove|cancel) (\d+)/i, (msg) => {
      try {
        const resp = cancelScheduledJob(
          robot,
          REMINDER_JOBS,
          REMINDER_KEY,
          msg.message.text ?? "",
          msg.match[1],
        )
        msg.reply(resp)
      } catch (error) {
        robot.logger.error(
          `updateScheduledJob Error: ${
            error instanceof Error ? error.message : "(unknown error)"
          }`,
        )
        msg.reply("Something went wrong deleting this reminder.")
      }
    })
  })
}
