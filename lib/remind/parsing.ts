import * as dayjs from "dayjs"
import { Envelope } from "hubot"
import { MatrixMessage } from "hubot-matrix"
import { JobMessageInfo, JobSpec, RecurringSpec, SingleShotSpec } from "./data"

// Match an interval specifier for "every <interval> <day>"-style text.
const intervalMatcher =
  /(?:(other|second|third|fourth|fifth|[0-9]{1,2}(?:th|rd|st|nd)) )?/

// Match text that looks like a job spec. Supported formats are:
// - "W next Thursday"
// - "X in 5 days"
// - "Y on Monday"
// - "Z every second Tuesday"
// - "A every 3rd Wednesday"
const specMatcher =
  // Day spec needs to include possible interval spec + one word.
  /\s+(?<type>in|on|next|every)\s+(?<daySpec>(?:(other|second|third|fourth|fifth|[0-9]{1,2}(?:th|rd|st|nd)) )?[^\s]+)?\s*(?:at\s+(?<timeSpec>[^\s]+))?(?:\W|$)|\s+(?:at\s+(?<timeSpec2>[^\s]+))?(?:\W|$)/

// Match text that contains a reminder command.
const startMatcher = /remind (?<who>me|team|here|room) (?:to )?(?<message>.*)$/

// Match weekdays, allowing for arbitrary abbreviation (e.g. M or Mo or Mon or
// Monday).
const weekDayMatcher = new RegExp(
  "M(o(n(d(a(y)?)?)?)?)?|" +
    "Tu(e(s(d(a(y)?)?)?)?)?|" +
    "W(e(d(n(e(s(d(a(y)?)?)?)?)?)?)?)?|" +
    "Th(u(r(s(d(a(y)?)?)?)?)?)?|" +
    "F(r(i(d(a(y)?)?)?)?)?|" +
    "Sa(t(u(r(d(a(y)?)?)?)?)?)?|" +
    "Su(n(d(a(y)?)?)?)?",
)

/**
 * Normalizes a day of the week that matches the weekDayMatcher to a numeric
 * day of the week.
 *
 * If the weekday couldn't be interpreted, it is interpreted as Sunday.
 */
function normalizeDayOfWeek(dayOfWeek: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
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
  return parseInt(interval.match(/[0-9]{1,2}/)?.[1] ?? "1", 10)
}

function parseSingleSpec(
  jobDaySpecifier: string,
  jobTimeSpecifier: string,
): SingleShotSpec {
  // Start with today as the specified day.
  const specifiedDate = dayjs(jobDaySpecifier) // TODO Adapt to user timezone.

  const dayOfWeek = weekDayMatcher.exec(jobDaySpecifier)
  const daySpec =
    dayOfWeek !== null ? normalizeDayOfWeek(dayOfWeek[0]) : specifiedDate.day()

  const [hour, minute] = jobTimeSpecifier
    ?.trim()
    ?.split(/[:h]/)
    ?.slice(0, 2)
    ?.map((time) => parseInt(time.substring(0, 2), 10)) ?? [0, 0]
  const amPm = jobTimeSpecifier?.match(/(am|pm)/i)?.[1]

  const fullDayHour =
    amPm?.toLowerCase() === "pm" && hour <= 12 ? hour + 12 : hour

  const timeSpec = {
    hour: fullDayHour,
    minute,
  }

  const fullSpec = {
    dayOfWeek: daySpec,
    ...timeSpec,
  }

  return fullSpec
}

function parseRecurringSpec(
  jobDaySpecifier: string,
  jobTimeSpecifier: string,
): RecurringSpec {
  const interval = jobDaySpecifier?.match(intervalMatcher)?.[1] ?? "1"
  const normalizedInterval = normalizeInterval(interval)
  const dayOfWeek = weekDayMatcher.exec(jobDaySpecifier)

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

  const fullSpec = {
    ...daySpec,
    hour: fullDayHour,
    minute,
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

export default function parseFromString(envelope: Envelope): JobSpec | null {
  // eslint-disable-next-line import/prefer-default-export
  const str = envelope.message.text ?? ""

  const specString = specMatcher.exec(str)
  if (specString === null) {
    return null
  }

  const strWithoutSpec = `${str.substring(0, specString.index)} ${str.substring(
    specString.index + specString[0].length,
  )}`
  const messageMatch = startMatcher.exec(strWithoutSpec)
  if (messageMatch === null) {
    return null
  }

  const {
    type: jobTypeSpecifier,
    daySpec: jobDaySpecifier,
    timeSpec: jobTimeSpecifier1,
    timeSpec2: jobTimeSpecifier2,
  } = specString.groups ?? {}

  const { who, message } = messageMatch.groups ?? {}

  const messageInfo: JobMessageInfo = {
    message: userTagForWhoMatch(who, envelope.user.id) + message,
    userId: envelope.user.id,
    room: envelope.room,
  }
  // Extract thread id if available.
  const envelopeMessage = envelope.message
  if (
    "metadata" in envelopeMessage &&
    (envelopeMessage as MatrixMessage).metadata.threadId !== undefined
  ) {
    messageInfo.threadId = (envelopeMessage as MatrixMessage).metadata.threadId
  }

  // Match can be either for the day-included version or the no-day version.
  const jobTimeSpecifier = jobTimeSpecifier1 ?? jobTimeSpecifier2

  if (jobTypeSpecifier === "every") {
    const spec = parseRecurringSpec(jobDaySpecifier, jobTimeSpecifier)
    return {
      type: "recurring",
      messageInfo,
      spec,
    }
  }

  const spec = parseSingleSpec(jobDaySpecifier, jobTimeSpecifier)
  return {
    type: "single",
    messageInfo,
    spec,
  }
}
