// Description:
//   Schedule a reminder message in both cron-style and datetime-based format
//   pattern
//   Based on hubot-schedule by matsukaz <matsukaz@gmail.com>
//   Modified for flowdock, converted to JS, and updated to accept natural
//   language input for date patterns
//
// Commands:
//   hubot remind "<day or date in English>" <message> - Schedule a reminder that runs on a specific date and time.
//   hubot remind <flow> "<day or date in English>" <message> - Schedule a reminder to a specific flow.
//   hubot reminder [cancel|del|delete|remove] <id> - Cancel the reminder
//   hubot reminder [upd|update] <id> <message> - Update reminder message
//   hubot reminder list - List all scheduled reminders for current flow. NOTE all times are listed in UTC
//   hubot reminder list <flow> - List all scheduled reminders for specified flow. NOTE all times are listed in UTC
//   hubot reminder list all - List all scheduled reminders for any flows. NOTE all times are listed in UTC
//
// Author:
//   kb0rg
//

const {
  getRoomIdFromName,
  getPublicJoinedFlowIds,
  isRoomInviteOnly,
  robotIsInRoom,
} = require("../lib/flowdock-util")

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
} = require("../lib/schedule-util")

const REMINDER_JOBS = {}
const REMINDER_KEY = "hubot_reminders"

module.exports = function(robot) {
  robot.brain.on("loaded", () => {
    return syncSchedules(robot, REMINDER_KEY, REMINDER_JOBS)
  })

  if (!robot.brain.get(REMINDER_KEY)) {
    robot.brain.set(REMINDER_KEY, {})
  }

  // TODO: update pattern/ help to use improved syntax
  // --> remind [me|@username] [in <flowname>] [when|how often] <what>
  robot.respond(/remind (.*)?"(.*?)" ((?:.|\s)*)$/i, function(msg) {
    let targetRoom = msg.match[1] // optional name of room specified in msg
    let targetRoomId = null

    if (!isBlank(targetRoom)) {
      targetRoomId = getRoomIdFromName(robot.adapter, targetRoom)

      if (isRestrictedRoom(targetRoomId, robot, msg)) {
        return msg.send(
          `Creating reminder for the ${targetRoom} flow is restricted.`,
        )
      }

      if (!robotIsInRoom(robot.adapter, targetRoomId)) {
        return msg.send(
          `Can't create reminder for ${targetRoom}: I'm not in that flow, or there's a typo in the name.`,
        )
      }
    }
    try {
      let resp = createScheduledJob(
        robot,
        REMINDER_JOBS,
        REMINDER_KEY,
        msg.message.user,
        targetRoomId || targetRoom,
        msg.match[2],
        msg.match[3],
      )
      msg.send(resp)
    } catch (error) {
      robot.logger.error(`createScheduledJob Error: ${error.message}`)
      msg.send("Something went wrong adding this reminder.")
    }
  })

  robot.respond(/reminder list(?: (all|.*))?/i, function(msg) {
    let id, job, rooms, showAll, outputPrefix
    const targetRoom = msg.match[1]
    const roomId = msg.message.user.room // room command is called from
    let targetRoomId = null
    let output = ""

    // If targetRoom is specified, check whether list for is permitted.
    if (!isBlank(targetRoom) && targetRoom != "all") {
      targetRoomId = getRoomIdFromName(robot.adapter, targetRoom)
      if (!robotIsInRoom(robot.adapter, targetRoomId)) {
        return msg.send(
          `Sorry, I'm not in the ${targetRoom} flow - or maybe you mistyped?`,
        )
      }
      if (isRoomInviteOnly(robot.adapter, robot.adapterName, targetRoomId)) {
        if (msg.message.user.room != targetRoomId) {
          return msg.send(
            `Sorry, that's a private flow. I can only show jobs scheduled from that flow from within the flow.`,
          )
        }
      }
    }

    // only get DMs from user who called list, if user calls list from a DM
    let userIdForDMs = typeof roomId === undefined ? msg.message.user.id : null

    // Construct params for getting and formatting job list
    if (isBlank(targetRoom) || CONFIG.denyExternalControl === "1") {
      // If targetRoom is undefined or blank, show schedule for current room.
      // Room is ignored when HUBOT_SCHEDULE_DENY_EXTERNAL_CONTROL is set to 1
      rooms = [roomId]
    } else if (targetRoom === "all") {
      // Get list of public rooms.
      rooms = getPublicJoinedFlowIds(robot.adapter)
      // If called from a private room, add to list.
      calledFromPrivateRoom = isRoomInviteOnly(
        robot.adapter,
        robot.adapterName,
        roomId,
      )
      if (calledFromPrivateRoom) {
        rooms.push(roomId)
      }
    } else {
      // If targetRoom is specified, show jobs for that room.
      rooms = [targetRoomId]
      outputPrefix += `the ${targetRoom} flow:\n`
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
      let [dateJobs, cronJobs] = getScheduledJobList(
        REMINDER_JOBS,
        rooms,
        userIdForDMs,
      )
      output = formatJobsForListMessage(robot.adapter, dateJobs, false, showAll)
      output += formatJobsForListMessage(robot.adapter, cronJobs, true, showAll)

      if (!!output.length) {
        output = outputPrefix + "===\n" + output
        return msg.send(output)
      } else {
        return msg.send("No reminders have been scheduled")
      }
    } catch (error) {
      robot.logger.error(
        `Error getting or formatting reminder job list: ${error.message}\nFull error: %o`,
        error,
      )
      msg.send("Something went wrong getting the reminder list.")
    }
  })

  robot.respond(/reminder (?:upd|update) (\d+) ((?:.|\s)*)/i, msg => {
    try {
      let resp = updateScheduledJob(
        robot,
        REMINDER_JOBS,
        REMINDER_KEY,
        msg,
        msg.match[1],
        msg.match[2],
      )
      msg.send(resp)
    } catch (error) {
      robot.logger.error(`updateScheduledJob Error: ${error.message}`)
      msg.send("Something went wrong updating this reminder.")
    }
  })

  return robot.respond(/reminder (?:del|delete|remove|cancel) (\d+)/i, msg => {
    try {
      let resp = cancelScheduledJob(
        robot,
        REMINDER_JOBS,
        REMINDER_KEY,
        msg,
        msg.match[1],
      )
      msg.send(resp)
    } catch (error) {
      robot.logger.error(`updateScheduledJob Error: ${error.message}`)
      msg.send("Something went wrong deleting this reminder.")
    }
  })
}
