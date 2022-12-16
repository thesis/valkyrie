import * as dayjs from "dayjs"
import { Envelope, Message, User } from "hubot"
import { isMatrixAdapter } from "../adapter-util"
import { Job, RecurringSpec, SingleShotSpec } from "./data"
import parseFromString from "./parsing"

/**
 * Given the previous recurrence as an ISO-8601 date and a recurring or
 * single-shot spec, determines the next recurrence and returns it as an
 * ISO-8601 date.
 */
function computeNextRecurrence(
  previousRecurrenceISO: string,
  spec: RecurringSpec | SingleShotSpec,
): string {
  // Normalize single-shot specs to a recurring spec with weekly interval. For
  // the purposes of computing the next occurrence, these are the same.
  const normalizedSpec: RecurringSpec =
    "repeat" in spec ? spec : { ...spec, repeat: "week", interval: 1 }

  const { repeat, hour, minute } = normalizedSpec

  let repeatDate = dayjs(previousRecurrenceISO)

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
  private jobs: Job[]

  private activelyScheduling: boolean

  constructor(private robot: Hubot.Robot, initialJobs: Job[]) {
    this.jobs = initialJobs.slice().sort((a, b) => {
      if (a.next < b.next) {
        return 1
      }
      if (a.next > b.next) {
        return -1
      }
      return 0
    })
  }

  addJob(newJob: Job) {
    const maxIndex = this.jobs.findIndex((job) => newJob.next > job.next)
    if (maxIndex === -1) {
      this.jobs.push(newJob)
    } else {
      this.jobs.splice(maxIndex, 0, newJob)
    }

    // If there is no active scheduling loop, e.g. because there are no
    // scheduled jobs at the moment, start one.
    if (!this.activelyScheduling) {
      this.runAndSchedule()
    }
  }

  /**
   * Convenience method to add a job from a message envelope. Attempts to parse
   * the message as a job request and throws if the message could not be parsed.
   */
  addJobFromMessageEnvelope(envelope: Envelope): Job {
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

    this.addJob(job)

    return job
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
    const now = new Date().toISOString()

    // Index of the last job whose next execution was in the past.
    const pastJobsEndIndex = this.jobs.findIndex((job) => job.next <= now)
    const pastJobs = this.jobs.splice(0, pastJobsEndIndex + 1)

    console.log(
      JSON.stringify(pastJobs, undefined, 2),
      "\n",
      JSON.stringify(this.jobs, undefined, 2),
      pastJobsEndIndex,
      "\n",
      this.jobs.map((j) => j.next).join(", "),
      "\n",
      now,
    )

    // Update job list with the next recurrence for all recurring jobs that we
    // are about to execute.
    const recurringPastJobs = pastJobs.filter(
      (job): job is Job & { type: "recurring" } => job.type === "recurring",
    )
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

    // Could be quicker to push all and then sort, but do this for now.
    updatedRecurrences.forEach((job) => this.addJob(job))

    this.robot.brain.set("jobs", this.jobs)

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
      this.activelyScheduling = false
      return
    }

    // Schedule next run based on next job date.
    const nextJobDate = this.jobs[0].next
    this.robot.logger.info(
      `Found next job at ${nextJobDate}; scheduling in ${
        dayjs(nextJobDate).valueOf() - dayjs().valueOf()
      }ms`,
    )
    setTimeout(
      () => this.runAndSchedule(),
      dayjs(nextJobDate).valueOf() - dayjs().valueOf(),
    )

    this.activelyScheduling = true
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
                isMatrixAdapter(this.robot.adapter)
                  ? this.robot.adapter.sendThreaded(envelope, threadId, message)
                  : // If it isn't the matrix adapter, fall back on a standard message.
                    this.robot.send(envelope, message)

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
