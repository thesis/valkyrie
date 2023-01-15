import * as dayjs from "dayjs"
import * as utc from "dayjs/plugin/utc"
import * as timezone from "dayjs/plugin/timezone"
import { Envelope, Message, User } from "hubot"
import { sendThreaded } from "../adapter-util"
import {
  Job,
  PersistedJob,
  RecurringDefinition,
  SingleShotDefinition,
} from "./data"
import { parseFromString, parseSpec as parseJobSpec } from "./parsing"

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault("UTC")

/**
 * Given the previous recurrence as an ISO-8601 date and a recurring or
 * single-shot spec, determines the next recurrence and returns it as an
 * ISO-8601 date.
 */
function computeNextRecurrence(
  previousRecurrenceISO: string,
  spec: RecurringDefinition | SingleShotDefinition,
): string {
  // Normalize single-shot specs to a recurring spec with weekly interval. For
  // the purposes of computing the next occurrence, these are the same.
  const normalizedSpec: RecurringDefinition =
    "repeat" in spec ? spec : { ...spec, repeat: "week", interval: 1 }

  const { repeat, hour, minute } = normalizedSpec

  let repeatDate = dayjs.tz(previousRecurrenceISO)

  if (repeat === "month") {
    const { dayOfMonth } = normalizedSpec
    if (repeatDate.date() < dayOfMonth) {
      repeatDate = repeatDate.date(dayOfMonth)
    } else {
      repeatDate = repeatDate.add(1, "month").date(dayOfMonth)
    }
  } else if (repeat === "week") {
    const { interval, dayOfWeek } = normalizedSpec

    // FIXME Off by one here, saying "every Monday" on Monday will advance by
    // FIXME the interval instead of by 1. Probably need to resolve in
    // FIXME previousRecurrenceISO instead of special-casing in here.
    if (repeatDate.day() < dayOfWeek) {
      repeatDate = repeatDate.day(dayOfWeek)
    } else {
      repeatDate = repeatDate.add(interval, "week").day(dayOfWeek)
    }
  }

  return repeatDate
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0)
    .toISOString()
}

/**
 * A scheduler of jobs.
 */
export default class JobScheduler {
  private jobs: PersistedJob[]

  private jobsById: { [jobId: number]: PersistedJob }

  private maxId: number

  private nextScheduledRun: NodeJS.Timeout | undefined

  constructor(
    private robot: Hubot.Robot,
    initialJobs: PersistedJob[],
    private persistenceKey: string = "jobs",
  ) {
    this.maxId = initialJobs.reduce(
      (runningMax, { id }) => Math.max(runningMax, id),
      0,
    )

    this.jobsById = initialJobs.reduce(
      (jobsById, job) => ({ ...jobsById, [job.id]: job }),
      {},
    )

    this.jobs = initialJobs.slice().sort((a, b) => {
      if (a.next < b.next) {
        return 1
      }
      if (a.next > b.next) {
        return -1
      }
      return 0
    })

    this.runAndSchedule()
  }

  addJob(newJob: Job | PersistedJob): PersistedJob {
    const persistedJob =
      "id" in newJob
        ? newJob // Do not modify an already-set id.
        : {
            ...newJob,
            id: this.allocateNewId(),
          }

    this.jobsById[persistedJob.id] = persistedJob

    const maxIndex = this.jobs.findIndex((job) => newJob.next < job.next)
    if (maxIndex === -1) {
      this.jobs.push(persistedJob)
    } else {
      this.jobs.splice(maxIndex, 0, persistedJob)
    }

    // If there is no active scheduling loop, e.g. because there are no
    // scheduled jobs at the moment, start one.
    if (this.nextScheduledRun === undefined) {
      this.runAndSchedule()
    } else if (maxIndex === 0) {
      this.restartScheduleLoop()
    }

    return persistedJob
  }

  /**
   * Convenience method to add a job from a message envelope. Attempts to parse
   * the message as a job request and throws if the message could not be parsed.
   */
  addJobFromMessageEnvelope(envelope: Envelope): PersistedJob {
    const partialJob = parseFromString(envelope)

    if (partialJob === null) {
      throw new Error(
        `Failed to parse message ${envelope.message.text} as reminder.`,
      )
    }

    const job: Job = {
      ...partialJob,
      next: computeNextRecurrence(
        dayjs().subtract(1, "day").toISOString(),
        partialJob.spec,
      ),
    }

    return this.addJob(job)
  }

  /**
   * Update the job with the given id with a new message. Persists the jobs
   * immediately. Returns undefined if the job id was not found, otherwise
   * returns the updated job.
   */
  updateJobMessage(
    jobId: number,
    newMessage: string,
  ): PersistedJob | undefined {
    const job = this.jobsById[jobId]

    if (job === undefined) {
      return undefined
    }

    job.messageInfo.message = newMessage
    this.persistJobs()

    return job
  }

  updateJobSpec(jobId: number, specString: string): PersistedJob | undefined {
    const job = this.removeJobWithoutRescheduling(jobId)

    if (job === undefined) {
      return undefined
    }

    const parsedJobSpec = parseJobSpec(specString)
    if (parsedJobSpec === null) {
      // Re-add the job if we failed here, otherwise failing to parse means the
      // job is deleted!
      this.addJob(job)
      throw new Error("Could not parse recurrence spec.")
    }

    const { jobSpec } = parsedJobSpec
    job.spec = jobSpec.spec
    job.type = jobSpec.type

    return this.addJob(job)
  }

  /**
   * Removes and returns the job with the given id. Returns undefined if no job
   * with that id was found.
   */
  removeJob(jobId: number): PersistedJob | undefined {
    const shouldReschedule = this.jobs[0].id === jobId

    const job = this.removeJobWithoutRescheduling(jobId)

    if (shouldReschedule) {
      this.restartScheduleLoop()
    }

    return job
  }

  /**
   * Removes a job without triggering rescheduling if the job is next to
   * execute. Use this if another subsequent action will trigger rescheduling.
   */
  private removeJobWithoutRescheduling(
    jobId: number,
  ): PersistedJob | undefined {
    const job = this.jobsById[jobId]
    const jobIndex = this.jobs.findIndex(({ id }) => id === jobId)

    if (job === undefined || jobIndex === -1) {
      return undefined
    }

    this.jobs.splice(jobIndex, 1)
    delete this.jobsById[jobId]

    return job
  }

  /**
   * Returns a list of all jobs for the specified rooms, sorted in order of
   * next occurrence. If `roomIds` are not specified, returns all jobs.
   */
  jobsForRooms(...roomIds: string[]): PersistedJob[] {
    return this.jobs.filter(
      ({ messageInfo: { room } }) =>
        roomIds.length === 0 || roomIds.includes(room),
    )
  }

  /**
   * Reserves a new job id and returns it.
   */
  private allocateNewId(): number {
    this.maxId += 1
    return this.maxId
  }

  private persistJobs() {
    this.robot.brain.set(this.persistenceKey, this.jobs)
  }

  /**
   * Resets the scheduling loop, clearing the next scheduled execution and
   * rescheduling the next item.
   *
   * This should largely be used when the next item to run is changed, i.e.
   * when the first item in the jobs list is either deleted or added.
   */
  private restartScheduleLoop() {
    clearTimeout(this.nextScheduledRun)
    this.runAndSchedule()
  }

  /**
   * Runs any jobs that should run now, and schedules the next run.
   *
   * To do this, this function:
   * - Separates out all jobs that need to run (whose next execution is before
   *   or equal to now)
   * - For any of those jobs that are recurring, computes when their next
   *   recurrence will be.
   * - Reinserts those next recurrences into the sorted job list.
   * - Executes the jobs.
   * - Finally, schedules this same function run again whenever the next
   *   scheduled job needs to execute.
   */
  private runAndSchedule() {
    this.nextScheduledRun = undefined

    const now = new Date().toISOString()

    // Index of the last job whose next execution was in the past.
    const pastJobsEndIndex = this.jobs.findIndex((job) => job.next <= now)
    const pastJobs = this.jobs.splice(0, pastJobsEndIndex + 1)

    const { recurring: recurringPastJobs, single: singleShotPastJobs } =
      pastJobs.reduce(
        (jobsByType, job) => ({
          ...jobsByType,
          [job.type]: [job, ...jobsByType[job.type]],
        }),
        { recurring: [], single: [] } as {
          [type in PersistedJob["type"]]: PersistedJob[]
        },
      )

    // Update job list with the next recurrence for all recurring jobs that we
    // are about to execute.
    const updatedRecurrences = recurringPastJobs.map((job) => {
      let { next } = job
      // Skip any occurrences that would trigger now, since we're already
      // triggering this job at this point. NOTE: This makes the explicit
      // choice that if the scheduler misses multiple runs of a scheduled job,
      // it will skip all but one! This is done mostly to reduce nuisance,
      // so if it proves to be a poor choice it can be changed without concern.
      while (next <= now) {
        next = computeNextRecurrence(next, job.spec)
      }

      return {
        ...job,
        next,
      }
    })

    // Could be quicker to push all and then sort, but do this for now: re-add
    // jobs with their latest recurrences.
    updatedRecurrences.forEach((job) => this.addJob(job))
    // Clean up single-shot jobs from the by-id list.
    singleShotPastJobs.forEach((job) => delete this.jobsById[job.id])

    this.persistJobs()

    pastJobs.forEach((job) =>
      this.runJob(job).catch((error) => {
        this.robot.logger.error(
          `Error running job:\n${JSON.stringify(
            job,
            undefined,
            2,
          )}\nError was: ${error}`,
        )
      }),
    )

    // If there are no jobs left to schedule, don't schedule.
    if (this.jobs.length <= 0) {
      return
    }

    // Schedule next run based on next job date.
    const nextJobDate = this.jobs[0].next
    this.robot.logger.info(
      `Found next job at ${nextJobDate}; scheduling in ${
        dayjs(nextJobDate).valueOf() - dayjs().valueOf()
      }ms`,
    )

    this.nextScheduledRun = setTimeout(
      () => this.runAndSchedule(),
      dayjs(nextJobDate).valueOf() - dayjs().valueOf(),
    )
  }

  private async runJob(job: Job): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const { message, room, userId, threadId } = job.messageInfo
        const hubotUser = new User(userId)
        const envelope = {
          user: hubotUser,
          room,
          message: new Message(hubotUser),
        }

        const sendFunction =
          threadId === undefined
            ? () => this.robot.send(envelope, message)
            : () =>
                sendThreaded(this.robot.adapter, envelope, threadId, message)

        // Always delay job execution by a tick.
        setTimeout(() => {
          try {
            resolve(sendFunction())
          } catch (error) {
            reject(error)
          }
        })
      } catch (error) {
        reject(error)
      }
    })
  }
}
