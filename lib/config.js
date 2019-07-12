// Provides a collection of configuration validation helpers

const { getRoomIdFromName } = require("../lib/flowdock-util")

/* Given a robot and a room name, returns a boolean indicating whether or not
 * the room name represents a valid Flowdock flow, based on whether a flow id
 * can be found based on the room name.
 *
 * If the room name passed as an argument is null, or if the adapter isn't
 * properly set up or isn't a flowdock adapter, returns false.
 */
function isAlertRoomNameValid(robot, alertRoomName) {
  if (!alertRoomName || !getRoomIdFromName(robot, alertRoomName)) {
    return false
  }
  return true
}

/* Given a robot and a room name, checks the validity of the room name based on
 * the criteria outlined in the isAlertRoomNameValid function, and returns the
 * room ID if valid.
 *
 * If the room name is invalid:
 *  if the robot is using the shell adapter, logs and returns an empty string.
 *  if the robot is using any other adapter, throws an error.
 */
function fetchAlertRoomIdOrReportIssue(robot, alertRoomName) {
  if (!isAlertRoomNameValid(robot, alertRoomName)) {
    let alertRoomErrorMessage = `Could not get necessary flow id for room: ${alertRoomName}`
    if (robot.adapterName.toLowerCase() == "shell") {
      // this is local dev, just log it
      robot.logger.error(
        `${alertRoomErrorMessage}: This will break the build in production`,
      )
      return ""
    } else {
      // fail build if not using shell adapter: alerts won't work w/o valid room
      throw new Error(alertRoomErrorMessage)
    }
  }
  return getRoomIdFromName(robot, alertRoomName)
}

/* Given a robot and a config key, checks whether the config value is set, and
 * returns it if so.
 *
 * If the config value is not set:
 *  if the robot is using the shell adapter, logs and returns an empty string.
 *  if the robot is using any other adapter, throws an error.
 */
function fetchConfigOrReportIssue(robot, configKey) {
  if (!process.env[configKey]) {
    let configErrorMessage = `Could not get necessary value for configKey: ${configKey}`

    if (robot.adapterName.toLowerCase() == "shell") {
      // this is local dev, just log it
      robot.logger.error(
        `${configErrorMessage}: This will break the build in production`,
      )
      return ""
    } else {
      // fail build if not using shell adapter: alerts won't work w/o valid room
      throw new Error(configErrorMessage)
    }
  }
  return process.env[configKey]
}

module.exports = {
  isAlertRoomNameValid,
  fetchAlertRoomIdOrReportIssue,
  fetchConfigOrReportIssue,
}
