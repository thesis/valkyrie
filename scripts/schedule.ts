// Description:
//   Schedule a recurring message using crontab syntax.
//   Modified for flowdock, and converted to JS
//
//
// Commands:
//   hubot schedule [add|new] "<cron pattern>" <message> - Schedule a message that runs recurrently. For the wizards only. See https://crontab.guru/ or http://crontab.org/ for cron pattern syntax.
//   hubot schedule [add|new] <flow> "<cron pattern>" <message> - Schedule a message to a specific flow, using the cron pattern syntax as specified above.
//   hubot schedule [cancel|del|delete|remove] <id> - Cancel the schedule
//   hubot schedule [upd|update] <id> <message> - Update scheduled message
//   hubot schedule list - List all scheduled messages for current flow. NOTE all times are listed in UTC
//   hubot schedule list <flow> - List all scheduled messages for specified flow. NOTE all times are listed in UTC
//   hubot schedule list all - List all scheduled messages for any flows. NOTE all times are listed in UTC
//
// Author:
//   kb0rg
//   matsukaz <matsukaz@gmail.com>
//

import { Adapter, Robot } from "hubot"
import * as _ from "lodash"

import {
  getRoomIdFromName,
  getPublicJoinedRoomIds,
  isRoomNonPublic,
  robotIsInRoom,
} from "../lib/adapter-util.ts"
import {
  cancelScheduledJob,
  createScheduledJob,
  syncSchedules,
  updateScheduledJob,
} from "../lib/schedule-management.ts"

import {
  CONFIG,
  isRestrictedRoom,
  isBlank,
  isCronPattern,
  getScheduledJobList,
  formatJobsForListMessage,
  RECURRING_JOB_STORAGE_KEY,
} from "../lib/schedule-util.ts"

const JOBS = {}
const STORE_KEY = RECURRING_JOB_STORAGE_KEY

/** @typedef { import("hubot").Robot } Robot */

/**
 * @param {Robot} robot
 */
export default function setupSchedule(robot: Robot<Adapter>) {
  robot.brain.on("loaded", () => syncSchedules(robot, STORE_KEY, JOBS))

  if (!robot.brain.get(STORE_KEY)) {
    robot.brain.set(STORE_KEY, {})
  }

  robot.respond(
    /schedule (?:new|add)(?: )([^"]*(?="))"(.*?)" ((?:.|\s)*)$/i,
    (msg) => {
      // optional name of room specified in msg
      const targetRoom = msg.match[1]?.trim() ?? ""
      const targetRoomId = isBlank(targetRoom)
        ? msg.envelope.room
        : getRoomIdFromName(robot.adapter, targetRoom)
      const pattern = _.trim(msg.match[2])

      // store the metadata, but do not use it to post the job
      const metadata =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "metadata" in msg.message ? (msg.message as any).metadata : undefined

      // If the room id wasn't found at all, flag an error.
      if (!isBlank(targetRoom) && targetRoomId === undefined) {
        msg.reply(
          `Couldn't find room named ${targetRoom} - maybe you mistyped or I haven't been invited?`,
        )
        return
      }

      if (!isBlank(targetRoom)) {
        if (targetRoomId !== undefined && isRestrictedRoom(targetRoomId, msg)) {
          msg.send(
            `Creating schedule for the ${targetRoom} flow is restricted.`,
          )
          return
        }

        if (
          targetRoomId !== undefined &&
          !robotIsInRoom(robot.adapter, targetRoomId)
        ) {
          msg.send(
            `Can't create schedule for ${targetRoom}: I'm not in that flow, or there's a typo in the name.`,
          )
          return
        }
        return
      }

      if (!isCronPattern(pattern)) {
        msg.send(`"${pattern}" is an invalid pattern.
          See http://crontab.org/ or https://crontab.guru/ for cron-style format pattern.
          If you're trying to schedule a one-time reminder, try using the \`remind\` command:
          See \`help remind\` for more information.
          `)
        return
      }

      try {
        const resp = createScheduledJob(
          robot,
          JOBS,
          STORE_KEY,
          { ...msg.message.user, room: msg.envelope.room },
          targetRoomId ?? targetRoom,
          pattern,
          msg.match[3],
          metadata,
          false, // remindInThread: default to false for schedule jobs
        )
        msg.reply(resp)
      } catch (error) {
        robot.logger.error(
          `createScheduledJob Error: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        )
        msg.reply("Something went wrong adding this schedule.")
      }
    },
  )

  robot.respond(/schedule list(?: (all|.*))?/i, async (msg) => {
    let rooms
    let outputPrefix
    let calledFromPrivateRoom

    const messageRoomId = msg.envelope.room // room command is called from

    const targetRoom = msg.match[1]?.trim()
    const specificRoomTargeted = !isBlank(targetRoom) && targetRoom !== "all"
    // Keep nested ternary for now for expediency.
    // eslint-disable-next-line no-nested-ternary
    const targetRoomId = isBlank(targetRoom)
      ? // blank means use this room
        messageRoomId
      : targetRoom === "all"
      ? // all means we'll look up rooms separately
        undefined
      : // otherwise it's a room name
        getRoomIdFromName(robot.adapter, targetRoom)

    let output = ""
    // FIXME May not be true in Matrix.
    const calledFromDm = messageRoomId === undefined

    // If the room id wasn't found at all, flag an error.
    if (specificRoomTargeted && targetRoomId === undefined) {
      msg.reply(
        `Couldn't find room named ${targetRoom} - maybe you mistyped or I haven't been invited?`,
      )
      return
    }

    // If targetRoom is specified, check whether listing that room is
    // permitted.
    if (targetRoomId !== undefined) {
      if (!robotIsInRoom(robot.adapter, targetRoomId)) {
        msg.reply(`Sorry, I'm not in ${targetRoom} - or maybe you mistyped?`)
        return
      }

      if (
        isRoomNonPublic(robot.adapter, targetRoomId) &&
        messageRoomId !== targetRoomId
      ) {
        msg.reply(
          "Sorry, that's not a public room. I can only show jobs scheduled from that room from within the room.",
        )
        return
      }
    }

    // only get DMs from user who called list, if user calls list from a DM
    const userIdForDMs = calledFromDm ? msg.message.user.id : null

    // Construct params for getting and formatting job list
    if (isBlank(targetRoom) || CONFIG.denyExternalControl === "1") {
      // If targetRoom is undefined or blank, show schedule for current room.
      // Room is ignored when HUBOT_SCHEDULE_DENY_EXTERNAL_CONTROL is set to 1
      rooms = [messageRoomId]
    } else if (targetRoom === "all") {
      // Get list of public rooms.
      rooms = await getPublicJoinedRoomIds(robot.adapter)
      // If called from a private room, add to list.
      calledFromPrivateRoom = !calledFromDm
        ? isRoomNonPublic(robot.adapter, messageRoomId)
        : false
      if (calledFromPrivateRoom) {
        rooms.push(messageRoomId)
      }
    } else {
      // If targetRoom is specified, show jobs for that room.
      rooms = targetRoomId === undefined ? [] : [targetRoomId]
    }

    // Construct message string prefix
    outputPrefix = "Showing scheduled jobs for "
    if (isBlank(targetRoom) || CONFIG.denyExternalControl === "1") {
      outputPrefix += "THIS flow:\n"
    } else if (targetRoom === "all") {
      // If called from a private room, add to list.
      if (calledFromPrivateRoom || calledFromDm) {
        outputPrefix += "THIS flow AND "
      }
      outputPrefix += "all public flows:\n"
    } else {
      // If targetRoom is specified, show jobs for that room if allowed.
      outputPrefix += `the ${targetRoom} flow:\n`
    }

    try {
      const allJobs = getScheduledJobList(JOBS, rooms, userIdForDMs)
      const jobsList = allJobs
        .flatMap((jobs) =>
          formatJobsForListMessage(
            robot.adapter,
            jobs,
            jobs[0]?.isCron() ?? false,
          ),
        )
        .join("")

      if (output.length > 0) {
        output = `${outputPrefix}===\n${output}`
        msg.reply(`${outputPrefix}===
          ${jobsList}`)
        return
      }
      msg.reply("No messages have been scheduled")
      return
    } catch (error) {
      robot.logger.error(
        `Error getting or formatting job list: ${
          error instanceof Error ? error.message : "(unknown error)"
        }\nFull error: %o`,
        error,
      )
      msg.reply("Something went wrong getting the schedule list.")
    }
  })

  robot.respond(/schedule (?:upd|update) (\d+)\s((?:.|\s)*)/i, (msg) => {
    try {
      const resp = updateScheduledJob(
        robot,
        JOBS,
        STORE_KEY,
        msg.message.text ?? "",
        msg.match[1],
        msg.match[2],
      )
      msg.reply(resp)
    } catch (error) {
      robot.logger.error(
        `updateScheduledJob Error: ${
          error instanceof Error ? error.message : "(unknown)"
        }`,
      )
      msg.reply("Something went wrong updating this schedule.")
    }
  })

  robot.respond(/schedule (?:del|delete|remove|cancel) (\d+)/i, (msg) => {
    try {
      const resp = cancelScheduledJob(
        robot,
        JOBS,
        STORE_KEY,
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
      msg.reply("Something went wrong deleting this schedule.")
    }
  })
}
