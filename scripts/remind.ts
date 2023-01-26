// Description:
//   Create a reminder message
//
// Commands:
//   hubot remind [me|team|here|room] on `when` `message`, or `message` on `when` - Post a reminder message at a specific date and time (e.g. `March 13th at 1:45pm` or `Tuesday at 15:13`), in the current thread. NOTE all times are interpreted as being in your timezone per the timezone command.
//   hubot remind [me|team|here|room] in `when` `message`, or `message` in `when` - Post a reminder message at a relative time in the future (e.g. `in 5 days` or `in three hours` or `in 5 minutes`), in the current thread. NOTE all times are interpreted as being in your timezone per the timezone command.
//   hubot remind [me|team|here|room] every `when` `message`, or `message` every `when` - Post a message in the current room, as a new thread, every set amount of time (e.g. `every 5 days` or `every Monday at 1:45pm` or `every 3rd of the month at 15:13`). NOTE all times are interpreted as being in your timezone per the timezone command.
//   hubot remind [me|team|here|room] every weekday at `time` `message`, or `message` every weekday at `time` - Post a message in the current room, as a new thread, every weekday (Monday through Friday). Does not skip holidays. NOTE all times are interpreted as being in your timezone per the timezone command.
//   hubot remind(ers) [cancel|del|delete|remove] `id` - Cancel the reminder for the specified id.
//   hubot reminder(ers) [upd|update] `id` to say `message` - Update the message for the reminder with the specified id.
//   hubot reminder(ers) [upd|update] `id` to every `when` - Update the repetition of the reminder with the specified id, e.g. `to every 5 days` or `to every Monday at 1:35pm` or `to every 3rd of the month at 15:13`. NOTE all times are interpreted as being in your timezone per the timezone command.
//   hubot reminder(ers) [upd|update] `id` to every weekday at `time` - Update the repetition of the reminder with the specified id to be every weekday at the specified time. NOTE all times are interpreted as being in your timezone per the timezone command.
//   hubot reminder(ers) list - List all reminders for the current room or DM. NOTE all times are displayed in your timezone per the timezone command.
//   hubot reminder(ers) list `room` - List all reminders for the specified room. NOTE all times are displayed in your timezone per the timezone command.
//   hubot reminder(ers) list all - List all reminders for any public rooms (reminders in DMs or invite-only rooms are hidden from this list, except when called from a DM or private room). NOTE all times are displayed in your timezone per the timezone command.
//
// Author:
//   kb0rg
//   shadowfiend
//

import { Robot } from "hubot"
import {
  getRoomIdFromName,
  robotIsInRoom,
  isRoomNonPublic,
} from "../lib/adapter-util"
// @ts-expect-error module.exports vs TypeScript battle
import { userTimezoneFor } from "./user-preferences"
import JobScheduler from "../lib/remind"
import {
  formatJobForMessage,
  formatJobsForListMessage,
} from "../lib/remind/formatting"

import { isBlank } from "../lib/schedule-util"

module.exports = function setupRemind(robot: Robot) {
  robot.brain.once("loaded", () => {
    const jobScheduler = new JobScheduler(robot)

    robot.respond(/remind (me|team|here|room) ((?:.|\s)*)$/i, (msg) => {
      const timezone = userTimezoneFor(robot, msg.envelope.user.id)

      try {
        msg.reply(
          `Scheduled new reminder with ${formatJobForMessage(
            jobScheduler.addJobFromMessageEnvelope(msg.envelope, timezone),
            timezone,
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
      const timezone = userTimezoneFor(robot, msg.envelope.user.id)

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
        output = formatJobsForListMessage(jobs, timezone)

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
        const timezone = userTimezoneFor(robot, msg.envelope.user.id)

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
            : jobScheduler.updateJobSpec(id, specOrMessage, timezone)

          if (updatedJob === undefined) {
            msg.reply(`Could not find a reminder with id ${msg.match[1]}`)
            return
          }

          msg.reply(
            `Updated reminder to ${formatJobForMessage(updatedJob, timezone)}`,
          )
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
        const timezone = userTimezoneFor(robot, msg.envelope.user.id)

        try {
          const removedJob = jobScheduler.removeJob(parseInt(msg.match[1], 10))

          if (removedJob === undefined) {
            msg.reply(`Could not find a reminder with id ${msg.match[1]}`)
            return
          }

          msg.reply(
            `Cancelled reminder with ${formatJobForMessage(
              removedJob,
              timezone,
            )}`,
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
