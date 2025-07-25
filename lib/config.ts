// Provides a collection of configuration validation helpers

import { Adapter } from "hubot"
import { getRoomInfoFromIdOrName, isRoomNameValid } from "./adapter-util.ts"

/**
 * Given a config key and an issueReporter:
 *
 * checks whether the config value is set, and returns it if so.
 *
 * If the config value is not set:
 * - if the robot is using the shell adapter, logs and returns an empty string.
 * - if the robot is using any other adapter, throws an error.
 */
export function fetchConfigOrReportIssue(
	configKey: string,
	issueReporter: (errorMessage: string) => void,
): string {
	if (!process.env[configKey]) {
		issueReporter(`Could not get necessary value for configKey: ${configKey}.`)
	}

	return process.env[configKey] || ""
}

/**
 * Given a robot and a set of config keys, reads all of the config values as
 * with [fetchConfigOrReportIssue]. If `fetchConfigOrReportIssue` completes
 * successfully for all keys, and all keys have non-blank values, returns a
 * function that takes a callback receiving all config values. Note that,
 * where `fetchConfigOrReportIssue` will return a blank value when a config key
 * is not found during development, `withConfigOrReportIssues` will only invoke
 * the config-based function if all expected keys are non-blank.
 *
 * An example:
 * ```
 * withConfigOrReportIssues(reporter, "config1", "config2")((config1, config2) => {
 *   // - receives the values of config keys "config1" and "config2" in order
 *   // - throws an exception if fetchConfigOrReportIssue throws an exception
 *   //   due to the config key not existing during a production run
 *   // - this function is not called if config1 or config2 keys had blank
 *   //   were not found in the config
 * })
 * ```
 *
 * The reporter is used to report a startup error if there is an issue looking
 * up a config key in production.
 */
export function withConfigOrReportIssues(
	issueReporter: (errorMessage: string) => void,
	...keys: string[]
) {
	const values = keys
		.map((_) => fetchConfigOrReportIssue(_, issueReporter))
		.filter((_) => _.length > 0)

	return (valueHandler: (...configValues: string[]) => void) => {
		if (values.length === keys.length) {
			valueHandler(...values)
		}
	}
}

/**
 * Given a robot and a room name, checks the validity of the room name based on
 * the criteria outlined in the isRoomNameValid function, and returns the room
 * object if valid.
 *
 * If the room name is invalid:
 * - if the robot is using the shell adapter, logs and returns an empty string.
 * - if the robot is using any other adapter, throws an error.
 */
export function fetchRoomInfoOrReportIssue(
	robot: Hubot.Robot<Adapter>,
	roomName: string,
): string {
	if (!isRoomNameValid(robot.adapter, roomName)) {
		robot.logger.warning(
			`Could not get flow object for: ${roomName}. This will break the build when connected to flowdock.`,
		)
	}
	const roomId = getRoomInfoFromIdOrName(robot.adapter, roomName)?.roomId
	if (roomId === undefined) {
		robot.logger.warning(
			`Could not get flow object for: ${roomName}. This will break the build when connected to flowdock.`,
		)
	}
	return roomId ?? ""
}

/**
 * Given a robot and an error message:
 *
 * - if the robot is using the shell adapter, logs and returns an empty string.
 * - if the robot is using any other adapter, throws an error.
 */
function logOrThrow(robot: Hubot.Robot<Adapter>, errorMessage: string) {
	if (robot.adapterName.toLowerCase() !== "flowdock") {
		// this is local dev, just log it
		robot.logger.warning(
			`${errorMessage} This will break the build when connected to flowdock.`,
		)
		return ""
	}
	// fail build if not using shell adapter: command will not work
	throw new Error(errorMessage)
}

export function issueReporterForRobot(
	robot: Hubot.Robot<Adapter>,
): (errorMessage: string) => void {
	return (errorMessage: string) => {
		logOrThrow(robot, errorMessage)
	}
}
