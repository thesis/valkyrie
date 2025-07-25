import { DateTime } from "luxon"
import { encodeThreadId, matrixUrlFor } from "../adapter-util.ts"
import { PersistedJob, RecurringDefinition } from "./data.ts"

// List of escape regex patterns (search to replace) to use when formatting a
// reminder message for display. Used to show raw input and avoid tagging
// people when simply trying to explore the reminder list.
const formattingEscapes = {
	"(@@?)": "[$1]",
	"```": "\n```\n",
	"#": "[#]",
	"\n": "\n>",
}

function formatNextOccurrence(
	nextIsoRecurrenceDate: string,
	timezone?: string,
): string {
	return DateTime.fromISO(nextIsoRecurrenceDate)
		.setZone(timezone)
		.toFormat("ccc, ff ZZZZ")
}

function formatRecurringSpec(
	spec: RecurringDefinition,
	nextOccurrence: string,
	timezone?: string,
): string {
	const formattedNextOccurrence = formatNextOccurrence(nextOccurrence, timezone)

	if (spec.repeat === "week") {
		const baseDate = DateTime.now()
			.toUTC()
			.set({
				hour: spec.hour,
				minute: spec.minute,
			})
			.setZone(timezone)
		const daysOfWeek =
			typeof spec.dayOfWeek === "number" ? [spec.dayOfWeek] : spec.dayOfWeek

		const formattedDays = daysOfWeek
			.map((day) => baseDate.set({ weekday: day as 1 | 2 | 3 | 4 | 5 | 6 | 7 }).toFormat("EEEE"))
			.join(", ")

		return (
			formattedNextOccurrence +
			baseDate.toFormat(`' (recurs weekly at' HH:mm 'on ${formattedDays})'`)
		)
	}

	const baseDate = DateTime.now()
		.set({
			day: spec.dayOfMonth,
			hour: spec.hour,
			minute: spec.minute,
		})
		.setZone(timezone)

	return (
		formattedNextOccurrence +
		baseDate.toFormat("' (recurs monthly on the' d 'at' HH:mm')'")
	)
}

export function formatJobForMessage(
	job: PersistedJob,
	timezone?: string,
): string {
	const { message: jobMessage, room, threadId } = job.messageInfo

	const formattedSpec =
		job.type === "single"
			? formatNextOccurrence(job.next, timezone)
			: formatRecurringSpec(job.spec, job.next, timezone)

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

export function formatJobsForListMessage(
	jobs: PersistedJob[],
	timezone?: string,
) {
	return jobs.map((job) => formatJobForMessage(job, timezone)).join("\n\n")
}
