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

const _ = require("lodash")

const {
  getRoomIdFromName,
  getPublicJoinedFlowIds,
  isRoomNonPublic,
  robotIsInRoom,
} = require("../lib/adapter-util")

const {
  CONFIG,
  syncSchedules,
  isRestrictedRoom,
  createScheduledJob,
  isBlank,
  isCronPattern,
  updateScheduledJob,
  cancelScheduledJob,
  getScheduledJobList,
  formatJobsForListMessage,
  RECURRING_JOB_STORAGE_KEY,
} = require("../lib/schedule-util")

const JOBS = {}
const STORE_KEY = RECURRING_JOB_STORAGE_KEY

/** @typedef { import("hubot").Robot } Robot */

/**
 * @param {Robot} robot
 */
module.exports = function (robot) {
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
        ? msg.room
        : getRoomIdFromName(robot.adapter, targetRoom)
      const pattern = _.trim(msg.match[2])

      // store the metadata, but do not use it to post the job
      const { metadata } = msg.message

      // If the room id wasn't found at all, flag an error.
      if (!isBlank(targetRoom) && targetRoomId === undefined) {
        return msg.reply(
          `Couldn't find room named ${targetRoom} - maybe you mistyped or I haven't been invited?`,
        )
      }

      if (!isBlank(targetRoom)) {
        if (isRestrictedRoom(targetRoomId, robot, msg)) {
          return msg.send(
            `Creating schedule for the ${targetRoom} flow is restricted.`,
          )
        }

        if (!robotIsInRoom(robot.adapter, targetRoomId)) {
          return msg.send(
            `Can't create schedule for ${targetRoom}: I'm not in that flow, or there's a typo in the name.`,
          )
        }
      }

      if (!isCronPattern(pattern)) {
        return msg.send(`\"${pattern}\" is an invalid pattern.
          See http://crontab.org/ or https://crontab.guru/ for cron-style format pattern.
          If you're trying to schedule a one-time reminder, try using the \`remind\` command:
          See \`help remind\` for more information.
          `)
      }

      try {
        const resp = createScheduledJob(
          robot,
          JOBS,
          STORE_KEY,
          msg.message.user,
          targetRoomId || targetRoom || msg.message.user.room,
          pattern,
          msg.match[3],
          metadata,
          false, // remindInThread: default to false for schedule jobs
        )
        msg.reply(resp)
      } catch (error) {
        robot.logger.error(`createScheduledJob Error: ${error.message}`)
        msg.reply("Something went wrong adding this schedule.")
      }
    },
  )

  robot.respond(/schedule list(?: (all|.*))?/i, (msg) => {
    let rooms
    let outputPrefix
    let calledFromPrivateRoom

    const messageRoomId = msg.message.user.room // room command is called from

    const targetRoom = msg.match[1]?.trim()
    const specificRoomTargeted = !isBlank(targetRoom) && targetRoom !== "all"
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
      return msg.reply(
        `Couldn't find room named ${targetRoom} - maybe you mistyped or I haven't been invited?`,
      )
    }

    // If targetRoom is specified, check whether listing that room is
    // permitted.
    if (targetRoomId !== undefined) {
      if (!robotIsInRoom(robot.adapter, targetRoomId)) {
        return msg.reply(
          `Sorry, I'm not in ${targetRoom} - or maybe you mistyped?`,
        )
      }

      if (
        isRoomNonPublic(robot.adapter, robot.adapterName, targetRoomId) &&
        messageRoomId !== targetRoomId
      ) {
        return msg.reply(
          "Sorry, that's not a public room. I can only show jobs scheduled from that room from within the room.",
        )
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
      rooms = getPublicJoinedFlowIds(robot.adapter)
      // If called from a private room, add to list.
      calledFromPrivateRoom = !calledFromDm
        ? isRoomNonPublic(robot.adapter, robot.adapterName, messageRoomId)
        : false
      if (calledFromPrivateRoom) {
        rooms.push(messageRoomId)
      }
    } else {
      // If targetRoom is specified, show jobs for that room.
      rooms = [targetRoomId]
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
        return msg.reply(`${outputPrefix}===
          ${jobsList}`)
      }
      return msg.reply("No messages have been scheduled")
    } catch (error) {
      robot.logger.error(
        `Error getting or formatting job list: ${error.message}\nFull error: %o`,
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
        msg,
        msg.match[1],
        msg.match[2],
      )
      msg.reply(resp)
    } catch (error) {
      robot.logger.error(`updateScheduledJob Error: ${error.message}`)
      msg.reply("Something went wrong updating this schedule.")
    }
  })

  robot.respond(/schedule (?:del|delete|remove|cancel) (\d+)/i, (msg) => {
    try {
      const resp = cancelScheduledJob(robot, JOBS, STORE_KEY, msg, msg.match[1])
      msg.reply(resp)
    } catch (error) {
      robot.logger.error(`updateScheduledJob Error: ${error.message}`)
      msg.reply("Something went wrong deleting this schedule.")
    }
  })
}
