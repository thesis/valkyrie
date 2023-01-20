// Description:
//   A collection of utilities to manage user preferences.
//
// Commands:
//   hubot timezone <timezone specifier> - Sets the timezone for you, used in places like reminders.
//   hubot timezone - Tells you the timezone being used for your user.
//
// Author:
//   shadowfiend
//

import { Robot } from "hubot"
import * as dayjs from "dayjs"
import * as utc from "dayjs/plugin/utc"
import * as timezone from "dayjs/plugin/timezone"
import * as advancedFormat from "dayjs/plugin/advancedFormat"

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(advancedFormat)
dayjs.tz.setDefault("UTC")

const USER_PREFERENCES_BRAIN_KEY = "preferences"

export type UserPreferences = {
  timezone: string
}

// Eastern time in particular must be stated as EST5EDT to properly handle
// daylight savings time automatically (other timezones like CET, Pacific, etc,
// do this by default). Additionally, we want to support commonly-used aliases
// like "Pacific", "Eastern", etc which are not directly supported by dayjs.
const TIMEZONE_MAPS: { [alias: string]: string } = {
  Eastern: "EST5EDT",
  EST: "EST5EDT",
  EDT: "EST5EDT",
  Pacific: "PST8PDT",
  Central: "CST6CDT", // Time, Standard Time, Daylight Time
  Mountain: "America/Phoenix", // Time, Standard Time
  "Mountain Daylight Time": "America/Boise",
}

module.exports = (robot: Robot<any>) => {
  robot.respond(/timezone$/i, (msg) => {
    const userPreferences = robot.brain.get(USER_PREFERENCES_BRAIN_KEY)?.[
      msg.envelope.user.id
    ] as UserPreferences

    if ((userPreferences?.timezone ?? undefined) !== undefined) {
      msg.reply(`I have you in ${userPreferences.timezone}.`)
    } else {
      msg.reply(
        `I don't know your timezone, so I'm assuming ${dayjs().format(
          "zzz (z)",
        )}.`,
      )
    }
  })

  robot.respond(/timezone\s+(.*)/i, (msg) => {
    const userPreferences = robot.brain.get(USER_PREFERENCES_BRAIN_KEY)?.[
      msg.envelope.user.id
    ] as UserPreferences

    const existingTimezone = userPreferences?.timezone ?? dayjs().format("zzz")

    const trimmedUserTimezone = msg.match[1].trim()
    const adjustedTimezone =
      // Try to find a replacement in the maps
      TIMEZONE_MAPS[trimmedUserTimezone] ??
      // If not, try finding a replacement for just the first word if in the
      // format X Time, X Standard Time, or X Daylight Time.
      TIMEZONE_MAPS[
        trimmedUserTimezone.replace(/(Daylight|Standard)? Time/, "").trim()
      ] ??
      // If not, just use the provided value directly.
      msg.match[1]

    try {
      dayjs.tz("2023-08-19T17:15", adjustedTimezone)

      robot.brain.set(USER_PREFERENCES_BRAIN_KEY, {
        ...robot.brain.get(USER_PREFERENCES_BRAIN_KEY),
        [msg.envelope.user.id]: {
          ...userPreferences,
          timezone: adjustedTimezone,
        },
      })

      msg.reply(
        `Updated your timezone from ${existingTimezone} to ${adjustedTimezone}.`,
      )
    } catch (error) {
      msg.reply(
        `Couldn't properly understand ${msg.match[1]} as a timezone. Try ` +
          "going to https://greenwichmeantime.com/time-zone/ and using the " +
          "time zone listed as your local one halfway down the page (e.g. " +
          "`America/New_York`).",
      )
    }
  })
}

/**
 * Exported function to look up user preferences on a given robot for a given
 * user id.
 */
module.exports.userPreferencesFor = function userPreferencesFor(
  robot: Robot<any>,
  userId: string,
) {
  return robot.brain.get(USER_PREFERENCES_BRAIN_KEY)?.[
    userId
  ] as UserPreferences
}

module.exports.userTimezoneFor = function timezoneFor(
  robot: Robot<any>,
  userId: string,
) {
  return (
    module.exports.userPreferencesFor(robot, userId)?.timezone ??
    dayjs().format("Z")
  )
}
