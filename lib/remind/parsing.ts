import { Envelope } from "hubot"
import { MatrixMessage } from "hubot-matrix"
import { DateTime } from "luxon"
import {
  JobMessageInfo,
  JobDefinition,
  RecurringDefinition,
  SingleShotDefinition,
  JobSpec,
} from "./data"

// Note: the regexes below were debugged with https://regex101.com/'s debugger
// to great effect. That said, the "right" solution is probably to use a parser
// generator/an EBNF grammar or similar.

// Match a number specifier for "in <number> <unit>"-style text.
const numericTextMatcher =
  /(?:an?|one|two|three|four|five|six|seven|eight|nine|ten|[0-9]+)(?:\s|$)+/

// Match an interval specifier for "every <interval> <day>"-style text.
const intervalMatcher =
  /(?:other|seco|thi|four|fif|[0-9]{1,2})(?:th|rd|st|nd)?(?:\s|$)+/

// Match weekdays, allowing for arbitrary abbreviation (e.g. M or Mo or Mon or
// Monday).
const weekDayMatcher = new RegExp(
  "M(?:o(?:n(?:d(?:a(?:y)?)?)?)?)?|" +
    "Tu(?:e(?:s(?:d(?:a(?:y)?)?)?)?)?|" +
    "W(?:e(?:d(?:n(?:e(?:s(?:d(?:a(?:y)?)?)?)?)?)?)?)?|" +
    "Th(?:u(?:r(?:s(?:d(?:a(?:y)?)?)?)?)?)?|" +
    "F(?:r(?:i(?:d(?:a(?:y)?)?)?)?)?|" +
    "Sa(?:t(?:u(?:r(?:d(?:a(?:y)?)?)?)?)?)?|" +
    "Su(?:n(?:d(?:a(?:y)?)?)?)?",
)

// Match text that looks like a job spec. Supported formats are:
// - "W next Thursday"
// - "X in 5 days"
// - "Y on Monday"
// - "Z every second Tuesday"
// - "A every 3rd Wednesday"
const specMatcher = new RegExp(
  // Day spec needs to include possible interval spec + one word.
  "\\s*(?<type>in|on|next|every)\\s+" +
    "(?:" +
    `(?<relativeIntervalCount>${numericTextMatcher.source})` +
    "(?<relativeIntervalUnit>(?:minutes?|hours?|days?|weeks?)(?:\\s|$)+))?" +
    "(?<daySpec>" +
    `(?:${intervalMatcher.source})?` +
    `(?:(?:of the month|weekday|(?:${weekDayMatcher.source})s?)(?:\\s|$)+)?)?` +
    "(?:at\\s+(?<timeSpec>[^\\s]+)(?:\\s|$))?|" +
    "\\s+(?:at\\s+(?<timeSpec2>[^\\s]+))?(?:\\s|$)",
)

// Match text that contains a reminder command.
const startMatcher = /remind (?<who>me|team|here|room) (?:to )?(?<message>.*)$/s

/**
 * Normalizes a day of the week that matches the weekDayMatcher to a numeric
 * day of the week.
 *
 * If the weekday couldn't be interpreted, it is interpreted as Sunday.
 */
function normalizeDayOfWeek(dayOfWeek: string): number | number[] {
  if (dayOfWeek === "weekday") {
    return [1, 2, 3, 4, 5]
  }
  if (dayOfWeek.startsWith("M")) {
    return 1
  }
  if (dayOfWeek.startsWith("Tu")) {
    return 2
  }
  if (dayOfWeek.startsWith("W")) {
    return 3
  }
  if (dayOfWeek.startsWith("Th")) {
    return 4
  }
  if (dayOfWeek.startsWith("F")) {
    return 5
  }
  if (dayOfWeek.startsWith("Sa")) {
    return 6
  }
  return 0
}

/**
 * Normalizes an interval specifier that matches the intervalMatcher, like
 * "other", "second", etc meant to specify the interval between repetitions,
 * into a number of weeks that the specifier represents.
 *
 * If the interval couldn't be interpreted, it is interpreted as repeating
 * every week.
 */
function normalizeInterval(interval: string): number {
  if (interval === "second" || interval === "other") {
    return 2
  }
  if (interval === "third") {
    return 3
  }
  if (interval === "fourth") {
    return 4
  }
  if (interval === "fifth") {
    return 5
  }
  // Fall back to an interval of 1, i.e. "every".
  return parseInt(interval.match(/[0-9]{1,2}/)?.[0] ?? "1", 10)
}

/**
 * Normalizes a relative time count that matches the numericTextMatcher, like
 * "one", "two", etc meant to specify the relative time to an occurrence,
 * into a number of units that the count represents.
 *
 * If the count couldn't be interpreted, it is interpreted being a 1.
 */
function normalizeRelativeIntervalCount(relativeIntervalCount: string): number {
  switch (relativeIntervalCount) {
    case "a":
    case "an":
    case "one":
      return 1
    case "two":
      return 2
    case "three":
      return 3
    case "four":
      return 4
    case "five":
      return 5
    case "six":
      return 6
    case "seven":
      return 7
    case "eight":
      return 8
    case "nine":
      return 9
    case "ten":
      return 10
    default:
      // Fall back to count of 1.
      return parseInt(relativeIntervalCount.match(/[0-9]+/)?.[0] ?? "1", 10)
  }
}

function parseSingleSpec(
  jobDaySpecifier: string,
  jobTimeSpecifier: string,
  jobRelativeIntervalCount: string,
  jobRelativeIntervalUnit: string,
  timezone?: string,
): SingleShotDefinition {
  // Start with today as the specified day.
  const specifiedDate = DateTime.now().setZone(timezone)

  if (
    (jobRelativeIntervalUnit ?? null) === null ||
    (jobRelativeIntervalCount ?? null) === null
  ) {
    const dayOfWeek = weekDayMatcher.exec(jobDaySpecifier)
    const daySpec =
      dayOfWeek !== null
        ? normalizeDayOfWeek(dayOfWeek[0])
        : specifiedDate.weekday

    const [hour, minute] = jobTimeSpecifier
      ?.trim()
      ?.split(/[:h]/)
      ?.slice(0, 2)
      ?.map((time) => parseInt(time.substring(0, 2), 10)) ?? [0, 0]
    const amPm = jobTimeSpecifier?.match(/(am|pm)/i)?.[1]

    const fullDayHour =
      amPm?.toLowerCase() === "pm" && hour <= 12 ? hour + 12 : hour

    const utcDate = specifiedDate.set({ hour: fullDayHour, minute }).toUTC()
    // When we adjust the timezone, the correct day of the week may also
    // change! Use this adjustment to push the speced day of the week forward
    // or backward accordingly.
    const dayOfWeekAdjustment = specifiedDate.weekday - utcDate.weekday

    const timeSpec = {
      hour: utcDate.hour,
      minute: utcDate.minute ?? 0,
    }

    const fullSpec = {
      dayOfWeek:
        typeof daySpec === "number"
          ? daySpec - dayOfWeekAdjustment
          : daySpec.map((_) => _ - dayOfWeekAdjustment),
      ...timeSpec,
    }

    return fullSpec
  }

  const relativeIntervalCount = normalizeRelativeIntervalCount(
    jobRelativeIntervalCount.trim(),
  )
  // trim and singularize so we only deal with minute|hour|day|week.
  const relativeIntervalUnit = jobRelativeIntervalUnit.trim().replace(/s$/, "")

  // If available, extract hour and minute.
  const [hour, minute] =
    jobTimeSpecifier
      ?.trim()
      ?.split(/[:h]/)
      ?.slice(0, 2)
      ?.map((time) => parseInt(time.substring(0, 2), 10)) ?? []
  const amPm = jobTimeSpecifier?.match(/(am|pm)/i)?.[1]

  // When available, use the hour and minute from jobTimeSpecifier; otherwise,
  // use the current hour/minute, adjusting the relativeIntervalCount when
  // relevant.
  const fullDayHour =
    (amPm?.toLowerCase() === "pm" && hour <= 12 ? hour + 12 : hour) ??
    specifiedDate.hour +
      (relativeIntervalUnit === "hour" ? relativeIntervalCount : 0)
  const fullDayMinute =
    minute ??
    specifiedDate.minute +
      (relativeIntervalUnit === "minute" ? relativeIntervalCount : 0)

  const utcDate = specifiedDate
    .set({ hour: fullDayHour, minute: fullDayMinute })
    .toUTC()
  // When we adjust the timezone, the correct day of the week may also
  // change! Use this adjustment to push the speced day of the week forward
  // or backward accordingly.
  const dayOfWeekAdjustment = specifiedDate.weekday - utcDate.weekday

  const timeSpec = {
    hour: utcDate.hour,
    minute: utcDate.minute,
  }

  const fullSpec = {
    dayOfWeek:
      utcDate.weekday -
      dayOfWeekAdjustment +
      (relativeIntervalUnit === "day" ? relativeIntervalCount : 0) +
      (relativeIntervalUnit === "week" ? relativeIntervalCount * 7 : 0),
    ...timeSpec,
  }

  return fullSpec
}

function parseRecurringSpec(
  jobDaySpecifier: string,
  jobTimeSpecifier: string,
  timezone?: string,
): RecurringDefinition {
  const interval = jobDaySpecifier?.match(intervalMatcher)?.[0].trim() ?? "1"
  const normalizedInterval = normalizeInterval(interval)
  const trimmedDaySpecifier = jobDaySpecifier.trim().replace(/s$/, "")
  const dayOfWeek =
    trimmedDaySpecifier === "weekday"
      ? [trimmedDaySpecifier]
      : weekDayMatcher.exec(trimmedDaySpecifier)

  const daySpec =
    dayOfWeek === null
      ? // "every 5th" is the 5th day of the month.
        ({ repeat: "month", dayOfMonth: normalizedInterval } as const)
      : ({
          repeat: "week",
          interval: normalizedInterval,
          dayOfWeek: normalizeDayOfWeek(dayOfWeek[0]),
        } as const)

  // FIXME Default time, unification with second instance of this same logic.
  const [hour, minute] = jobTimeSpecifier
    ?.trim()
    ?.split(/[:h]/)
    ?.slice(0, 2)
    ?.map((time) => parseInt(time.substring(0, 2), 10)) ?? [0, 0]
  const amPm = jobTimeSpecifier?.match(/(am|pm)/i)?.[1]

  const fullDayHour =
    amPm?.toLowerCase() === "pm" && hour <= 12 ? hour + 12 : hour

  const adjustedTime = DateTime.now()
    .setZone(timezone)
    .set({ hour: fullDayHour, minute: minute ?? 0 })

  // Now use the hour and minute in the UTC timezone.
  const utcTime = adjustedTime.toUTC()

  const fullSpec = {
    ...daySpec,
    hour: utcTime.hour,
    minute: utcTime.minute,
  }

  return fullSpec
}

const whoToUserTag: { [name: string]: string } = {
  here: "@here, ",
  team: "@team, ",
  room: "@room, ",
}

function userTagForWhoMatch(who: string, userId: string): string {
  if (who === "me") {
    return `${userId}, `
  }
  return whoToUserTag[who] ?? ""
}

export function parseSpec(
  specString: string,
  timezone?: string,
): { jobSpec: JobSpec; specMatch: { index: number; length: number } } | null {
  const specMatch = specMatcher.exec(specString)
  if (specMatch === null) {
    return null
  }

  const {
    type: jobTypeSpecifier,
    daySpec: jobDaySpecifier,
    relativeIntervalCount: jobRelativeIntervalCount,
    relativeIntervalUnit: jobRelativeIntervalUnit,
    timeSpec: jobTimeSpecifier1,
    timeSpec2: jobTimeSpecifier2,
  } = specMatch.groups ?? {}

  // Match can be either for the day-included version or the no-day version.
  const jobTimeSpecifier = jobTimeSpecifier1 ?? jobTimeSpecifier2

  const jobSpec: JobSpec =
    jobTypeSpecifier === "every"
      ? {
          type: "recurring",
          spec: parseRecurringSpec(jobDaySpecifier, jobTimeSpecifier, timezone),
        }
      : {
          type: "single",
          spec: parseSingleSpec(
            jobDaySpecifier,
            jobTimeSpecifier,
            jobRelativeIntervalCount,
            jobRelativeIntervalUnit,
            timezone,
          ),
        }

  return {
    jobSpec,
    specMatch: {
      index: specMatch.index,
      length: specMatch[0].length,
    },
  }
}

export function parseFromString(
  envelope: Envelope,
  timezone?: string,
): JobDefinition | null {
  const str = envelope.message.text ?? ""

  const parsedSpec = parseSpec(str, timezone)
  if (parsedSpec === null) {
    return null
  }

  const { jobSpec: spec, specMatch } = parsedSpec

  const strWithoutSpec = `${str.substring(0, specMatch.index)} ${str.substring(
    specMatch.index + specMatch.length,
  )}`
  const messageMatch = startMatcher.exec(strWithoutSpec)
  if (messageMatch === null) {
    return null
  }

  const { who, message } = messageMatch.groups ?? {}

  const messageInfo: JobMessageInfo = {
    message: userTagForWhoMatch(who, envelope.user.id) + message,
    userId: envelope.user.id,
    room: envelope.room,
  }
  // Extract thread id if available for non-recurring messages. Note that
  // recurring messages are expected to start fresh threads on every
  // recurrence.
  const envelopeMessage = envelope.message
  if (
    "metadata" in envelopeMessage &&
    (envelopeMessage as MatrixMessage).metadata.threadId !== undefined &&
    spec.type === "single"
  ) {
    messageInfo.threadId = (envelopeMessage as MatrixMessage).metadata.threadId
  }

  return {
    ...spec,
    messageInfo,
  }
}
