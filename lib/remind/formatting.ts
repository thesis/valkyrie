import * as dayjs from "dayjs"
import * as utc from "dayjs/plugin/utc"
import * as timezone from "dayjs/plugin/timezone"
import * as localizedFormat from "dayjs/plugin/localizedFormat"
import * as advancedFormat from "dayjs/plugin/advancedFormat"

import { encodeThreadId, matrixUrlFor } from "../adapter-util"
import { PersistedJob, RecurringDefinition } from "./data"

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(localizedFormat)
dayjs.extend(advancedFormat)

// List of escape regex patterns (search to replace) to use when formatting a
// reminder message for display. Used to show raw input and avoid tagging
// people when simply trying to explore the reminder list.
const formattingEscapes = {
  "(@@?)": "[$1]",
  "```": "\n```\n",
  "#": "[#]",
  "\n": "\n>",
}

function formatNextOccurrence(nextIsoRecurrenceDate: string): string {
  return dayjs(nextIsoRecurrenceDate).format("llll z")
}

function formatRecurringSpec(
  spec: RecurringDefinition,
  nextOccurrence: string,
): string {
  const formattedNextOccurrence = formatNextOccurrence(nextOccurrence)

  if (spec.repeat === "week") {
    const baseDate = dayjs()
      .day(spec.dayOfWeek)
      .hour(spec.hour)
      .minute(spec.minute)

    return (
      formattedNextOccurrence +
      baseDate.format("[ (recurs weekly on] dddd [at] HH:mm[)]")
    )
  }

  const baseDate = dayjs()
    .date(spec.dayOfMonth)
    .hour(spec.hour)
    .minute(spec.minute)

  return (
    formattedNextOccurrence +
    baseDate.format("[ (recurs monthly on the] Do [at] HH:mm[)]")
  )
}

export function formatJobForMessage(job: PersistedJob): string {
  const { message: jobMessage, room, threadId } = job.messageInfo

  const formattedSpec =
    job.type === "single"
      ? formatNextOccurrence(job.next)
      : formatRecurringSpec(job.spec, job.next)

  // FIXME Resolve an actual display name here? Or let the adpater feed it to us?
  const jobRoomDisplayName = room

  const targetDisplayText =
    threadId === undefined
      ? `(to ${jobRoomDisplayName})`
      : `(to [thread in ${jobRoomDisplayName}](${matrixUrlFor(
          room,
          "thesis.co",
          encodeThreadId(threadId),
        )}))`

  const messageParsed = Object.entries(formattingEscapes).reduce(
    (formattedMessage, [pattern, replacement]) =>
      formattedMessage.replace(new RegExp(pattern, "g"), replacement),
    jobMessage,
  )

  return `ID ${job.id}: **${formattedSpec}** ${targetDisplayText}:\n>${messageParsed}\n\n`
}

export function formatJobsForListMessage(jobs: PersistedJob[]) {
  return jobs.map((job) => formatJobForMessage(job)).join("\n\n")
}
