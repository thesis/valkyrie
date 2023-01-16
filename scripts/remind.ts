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

import { Robot } from "hubot"
import {
  getRoomIdFromName,
  robotIsInRoom,
  isRoomNonPublic,
} from "../lib/adapter-util"
import JobScheduler from "../lib/remind"
import {
  formatJobForMessage,
  formatJobsForListMessage,
} from "../lib/remind/formatting"

import { isBlank } from "../lib/schedule-util"

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
          `Scheduled new reminder with ${formatJobForMessage(
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

    robot.respond(/remind(?:ers?)? list(?: (all|.*))?/i, async (msg) => {
      let outputPrefix
      const targetRoom = msg.match[1]
      let targetRoomId = null
      let output = ""

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

      try {
        const jobs = jobScheduler.jobsForRooms()
        output = formatJobsForListMessage(jobs)

        if (output.length) {
          output = `${outputPrefix ?? ""}\n\n----\n\n${output}`
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

    robot.respond(
      /remind(?:ers?)? (?:upd|update|edit) (?<id>\d+)\sto\s(?<specOrMessage>(?:.|\s)*)/i,
      (msg) => {
        try {
          const { id: unparsedId, specOrMessage } = msg.match.groups ?? {
            id: "",
            specOrMessage: "",
          }

          const id = parseInt(unparsedId, 10)

          const updatedJob = specOrMessage
            .trim()
            .toLowerCase()
            .startsWith("say")
            ? jobScheduler.updateJobMessage(
                id,
                specOrMessage.replace(/^say\s+/, ""),
              )
            : jobScheduler.updateJobSpec(id, specOrMessage)

          if (updatedJob === undefined) {
            msg.reply(`Could not find a reminder with id ${msg.match[1]}`)
            return
          }

          msg.reply(`Updated reminder to ${formatJobForMessage(updatedJob)}`)
        } catch (error) {
          robot.logger.error(
            `Error updating reminder (${JSON.stringify(msg.match)}): ${
              error instanceof Error
                ? `${error.message}\n${error.stack ?? ""}`
                : "(unknown error)"
            }`,
          )
          msg.reply("Something went wrong updating this reminder.")
        }
      },
    )

    robot.respond(
      /remind(?:ers?)? (?:del|delete|remove|cancel) (\d+)/i,
      (msg) => {
        try {
          const removedJob = jobScheduler.removeJob(parseInt(msg.match[1], 10))

          if (removedJob === undefined) {
            msg.reply(`Could not find a reminder with id ${msg.match[1]}`)
            return
          }

          msg.reply(
            `Cancelled reminder with ${formatJobForMessage(removedJob)}`,
          )
        } catch (error) {
          robot.logger.error(
            `Job deletion error: ${
              error instanceof Error ? error.message : "(unknown error)"
            }`,
          )
          msg.reply("Something went wrong deleting this reminder.")
        }
      },
    )
  })
}
