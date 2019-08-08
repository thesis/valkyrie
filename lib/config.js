// Provides a collection of configuration validation helpers

const { getRoomIdFromName, isRoomNameValid } = require("../lib/flowdock-util")

/**
 * Given a robot and a room name, checks the validity of the room name based on
 * the criteria outlined in the flowdock-utils.isRoomNameValid function, and
 * returns the room ID if valid.
 *
 * If the room name is invalid:
 * - if the robot is using the shell adapter, logs and returns an empty string.
 * - if the robot is using any other adapter, throws an error.
 */
function fetchRoomIdOrReportIssue(robot, roomName) {
  if (!isRoomNameValid(robot.adapter, roomName)) {
    logOrThrow(robot, `Could not get necessary flow id for room: ${roomName}.`)
  }
  return getRoomIdFromName(robot.adapter, roomName)
}

/**
 * Given a robot and a config key, checks whether the config value is set, and
 * returns it if so.
 *
 * If the config value is not set:
 * - if the robot is using the shell adapter, logs and returns an empty string.
 * - if the robot is using any other adapter, throws an error.
 */
function fetchConfigOrReportIssue(robot, configKey) {
  if (!process.env[configKey]) {
    logOrThrow(
      robot,
      `Could not get necessary value for configKey: ${configKey}.`,
    )
  }
  return process.env[configKey]
}

/**
 * Given a robot and an error message:
 *
 * - if the robot is using the shell adapter, logs and returns an empty string.
 * - if the robot is using any other adapter, throws an error.
 */
function logOrThrow(robot, errorMessage) {
  if (robot.adapterName.toLowerCase() == "shell") {
    // this is local dev, just log it
    robot.logger.warning(
      `${errorMessage} This will break the build in production.`,
    )
    return ""
  } else {
    // fail build if not using shell adapter: alerts won't work w/o valid room
    throw new Error(configErrorMessage)
  }
}

module.exports = {
  fetchRoomIdOrReportIssue,
  fetchConfigOrReportIssue,
}
