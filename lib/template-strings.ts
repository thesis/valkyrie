import { Adapter, Brain } from "hubot"
import { RECURRING_JOB_STORAGE_KEY } from "./schedule-config.ts"
import { ScheduledJob } from "./scheduled-jobs.ts"

// This is a temporary function to test the template string behavior.
// It takes a string, coverts it to an int, and returns its square.
function test(inputString: string): string {
	const inputValue = parseInt(inputString, 10)
	if (Number.isNaN(inputValue)) {
		throw new Error(
			`Could not complete test function because "${inputString}" does not convert to an integer.`,
		)
	}
	return (inputValue * inputValue).toString()
}

/**
 * Given a string (either "self" or the job id of another scheduled job), a
 * robot brain, and the currently running job object, returns:
 * - the url of the posted message for the previous invocation of the job
 * specified in the input string,
 * or
 * - "(last url not found)" if the job exists but it does not have a saved
 * lastUrl value.
 *
 * Throws an error if the input string is a job id, and the corresponding job
 * is not found in the robot brain.
 */
function lastUrl(
	inputString: string,
	robotBrain: Brain<Adapter>,
	runningJob: ScheduledJob | Record<string, never>,
): string {
	let ret

	if (inputString === "self") {
		ret = "metadata" in runningJob ? runningJob.metadata.lastUrl : undefined
	} else {
		const jobId = inputString

		// This feature is only enabled for cron jobs, so we can hard-code the storage key here
		const serializedJob = robotBrain.get(RECURRING_JOB_STORAGE_KEY)[jobId]
		if (!serializedJob) {
			throw new Error(`${jobId}: Scheduled job not found.`)
		}
		ret = serializedJob[3]?.lastUrl
	}
	return ret ?? "(last url not found)"
}

const TEMPLATE_STRING_DISPATCHER: {
	[name: string]: (
		message: string,
		robotBrain: Brain<Adapter>,
		runningJob: ScheduledJob | Record<string, never>,
	) => string
} = {
	test,
	"last-url": lastUrl,
}

/**
 * Given a message string from a scheduled job, returns:
 * A message that should be displayed to the user.
 */
export default function processTemplateString(
	message: string,
	robotBrain: Brain<Adapter>,
	runningJob: ScheduledJob | Record<string, never>,
): string {
	const templateStringMatch = message.match(/\{\{(.*?):(.*?)\}\}/i)
	if (!templateStringMatch) {
		return message
	}
	const [templateString, templateStringCommand, templateStringValue] =
		templateStringMatch
	let templateStringFormatted = ""

	try {
		const allowedCommand =
			TEMPLATE_STRING_DISPATCHER[templateStringCommand.trim()]

		if (!allowedCommand) {
			throw new Error(
				`"${templateStringCommand}" is not a valid templated command.`,
			)
		}
		templateStringFormatted = allowedCommand(
			templateStringValue.trim(),
			robotBrain,
			runningJob,
		)
	} catch (error) {
		throw new Error(
			`Could not process template string in message: ${
				error instanceof Error ? error.message : "(unknown error)"
			}`,
		)
	}

	return processTemplateString(
		message.replace(templateString, templateStringFormatted),
		robotBrain,
		runningJob,
	)
}
