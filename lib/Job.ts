import * as hubot from "hubot"
import { MatrixMessage } from "hubot-matrix"
import * as scheduler from "node-schedule"
import util from "util"
import { isMatrixAdapter } from "./adapter-util.ts"
import CONFIG, { RECURRING_JOB_STORAGE_KEY } from "./schedule-config.ts"
import {
	isCronPattern,
	logSerializedJobDetails,
	updateJobInBrain,
	urlFor,
} from "./schedule-util.ts"
import { JobUser, MessageMetadata, ScheduledJob } from "./scheduled-jobs.ts"
import processTemplateString from "./template-strings.ts"

export async function postMessageAndSaveThreadId(
	robot: hubot.Robot,
	envelope: Omit<hubot.Envelope, "message">,
	job: Job,
	messageText: string,
) {
	if (!isMatrixAdapter(robot.adapter)) {
		throw new Error(
			"Adapter is not the Matrix adapter, scheduling unsupported.",
		)
	}

	const postedEvent = await robot.adapter.sendThreaded(
		{ ...envelope, message: new hubot.TextMessage(envelope.user, "", "") },
		// Though the job may have an associated thread id, reminders spawn their
		// own threads.
		undefined,
		messageText,
	)

	if (postedEvent === undefined) {
		throw new Error("Unexpected undefined Matrix client")
	}

	const threadId = postedEvent.event_id
	const eventId = postedEvent.event_id
	const url = urlFor(envelope.room, "thesis.co", eventId)

	if (CONFIG.dontReceive !== "1") {
		// Send message to the adapter, to allow hubot to process the message.
		const messageObj = new MatrixMessage(envelope.user, messageText, "", {
			threadId,
		})
		robot.adapter.receive(messageObj)
	}

	// Update the job in memory, and ensure metadata exists
	// eslint-disable-next-line no-param-reassign
	job.metadata.lastUrl = url

	// Update the job in brain and log the update.
	const serializedJob = updateJobInBrain(
		robot.brain,
		RECURRING_JOB_STORAGE_KEY,
		job,
	)
	logSerializedJobDetails(
		robot.logger,
		serializedJob,
		"Updated job's last url after posting latest occurrence",
		job.id,
	)
}

export default class Job implements ScheduledJob {
	public user: JobUser

	public job?: scheduler.Job

	constructor(
		public id: string,
		public pattern: string,
		user: JobUser,
		public room: string,
		public message: string,
		private cb: (() => void) | undefined,
		public metadata: MessageMetadata,
		public remindInThread = false,
	) {
		this.user = {
			room: room || user.room,
			name: user.name,
			id: user.id,
		}
	}

	isCron(): boolean {
		return isCronPattern(this.pattern)
	}

	start(robot: hubot.Robot) {
		// eslint-disable-next-line no-return-assign
		return (this.job = scheduler.scheduleJob(this.pattern, () => {
			const { lastUrl: _, threadId, ...threadlessMetadata } = this.metadata
			const envelope = {
				user: new hubot.User(this.user.id, this.user),
				room: this.user.room,
				message: new hubot.Message(new hubot.User(this.user.id, this.user)),
				metadata: this.remindInThread
					? { ...threadlessMetadata, threadId }
					: (threadlessMetadata as MessageMetadata),
			}

			let processedMessage = ""
			try {
				processedMessage = processTemplateString(
					this.message,
					robot.brain,
					this,
				)
			} catch (error) {
				robot.logger.error(
					`Problem processing message at job start: ${util.inspect(error)}`,
				)
				// Do not throw error since this will fail invisibly to the user. Return unprocessed message.
				// However, we should not hit this case since job creation will fail with an error.
				processedMessage = this.message
			}

			if (!isCronPattern(this.pattern)) {
				// Send via adapter if the job is a DateTime, not recurring job (these
				// get deleted after sending, so there is no way to look up their
				// lastUrl).
				robot.adapter.send(envelope, processedMessage)

				if (CONFIG.dontReceive !== "1") {
					// Send message to the adapter, to allow hubot to process the message.
					// We handle this case in the postMessageCallback for all API-posted jobs.
					const messageObj = new MatrixMessage(
						new hubot.User(this.user.id, this.user),
						processedMessage,
						"",
						// Datetime jobs created via `remind` retain thread_id in metadata.
						envelope.metadata,
					)
					robot.adapter.receive(messageObj)
				}
			} else {
				try {
					// Recurring jobs should post via API instead, so we can save thread id.
					postMessageAndSaveThreadId(robot, envelope, this, processedMessage)
				} catch (err) {
					robot.logger.error("Error posting scheduled message", err)
				}
			}

			return typeof this.cb === "function" ? this.cb() : undefined
		}))
	}

	cancel() {
		if (this.job) {
			scheduler.cancelJob(this.job)
		}
		return typeof this.cb === "function" ? this.cb() : undefined
	}

	serialize(): readonly [string, JobUser, string, MessageMetadata, boolean] {
		return [
			this.pattern,
			this.user,
			this.message,
			this.metadata,
			this.remindInThread,
		] as const
	}
}
