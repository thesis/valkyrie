/* eslint-disable max-classes-per-file */
import { Envelope, Message, User } from "hubot"
import { MatrixMessage } from "hubot-matrix"
import * as moment from "moment"

type JobMessageInfo = {
  userId: string
  message: string
  room: string
  threadId?: string
}

type BaseJob<Type extends string, SpecType> = {
  type: Type
  messageInfo: JobMessageInfo
  next: string
  spec: SpecType
}

type SingleJob = BaseJob<"single", SingleSpec>
type RecurringJob = BaseJob<"recurring", RecurringSpec>

type Job = SingleJob | RecurringJob

type SingleSpec = { hour: number; minute: number; dayOfWeek: number }

type RecurringSpec =
  | (SingleSpec & {
      repeat: "week"
      interval: number
    })
  | {
      hour: number
      minute: number
      repeat: "month"
      dayOfMonth: number
    }

class JobScheduler {
  private jobs: Job[]

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

    this.runAndSchedule()
  }

  addJob(newJob: Job) {
    const maxIndex = this.jobs.findIndex((job) => newJob.next > job.next)
    if (maxIndex === -1) {
      this.jobs.push(newJob)
    } else {
      this.jobs.splice(maxIndex, 0, newJob)
    }
  }

  /* Execution engine:
   *
   * All jobs are inserted sorted by next execution in the job list.
   *
   * - On start, traverse past jobs and remove them from the list.
   * - First future job is scheduled immediately.
   * - Past jobs that were not recurring (?) are executed with a
   *   flag that they are non-scheduled.
   * - On job execution:
   *   - Drop the job from the front of the job list.
   *   - If recurring
   *     - Before executing, compute next execution and insert
   *       into job list in sorted order.
   *     - If insertion makes it first job, drop existing
   *       schedule and schedule this job.
   *   - Persist job list.
   *   - If this was a scheduled job run (i.e. not a past exec),
   *     schedule the next top job.
   *   - Async run job body.
   *
   *   const lastPastIndex = jobs.findIndex(({ next }) => !next.isBeforeOrSame(today))
   *   const [past, future] = [jobs.slice(0, lastPastIndex), jobs.slice(lastPastIndex)]
   *   // Run past jobs first in case they update the future list.
   *   const additionalJobs = past.map((job) => runJob(job)).filter(isDefined)
   *   scheduleNextRun(future[0].next) // reruns this loop
   */

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
    const pastJobs = this.jobs.splice(0, pastJobsEndIndex)

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
        next = Jobber.computeNextRecurrence(next, job.spec)
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

    // Schedule next run based on next job date.
    const nextJobDate = this.jobs[0].next
    setTimeout(
      () => this.runAndSchedule(),
      moment(nextJobDate).valueOf() - moment().valueOf(),
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
          metadata: threadId === undefined ? {} : { threadId },
        }

        // Always delay job execution by a tick.
        setTimeout(() => {
          try {
            resolve(this.robot.send(envelope, message))
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

class Jobber {
  static specMatcher =
    // Day spec needs to include possible interval spec + one word.
    /\s+(?<type>in|on|every)\s+(?<daySpec>(?:(other|second|third|fourth|fifth|[0-9]{1,2}th) )?[^\s]+)?\s*(?:at\s+(?<timeSpec>[^\s]+))?(?:\W|$)|\s+(?:at\s+(?<timeSpec2>[^\s]+))?(?:\W|$)/

  static startMatcher = /remind (me|team|here) (?:to )?(?<message>.*)$/

  static parseFromString(str: string, envelope: Envelope): Job | null {
    const spec = this.specMatcher.exec(str)
    console.log("Spec", spec)
    if (spec === null) {
      return null
    }

    const strWithoutSpec = `${str.substring(0, spec.index)} ${str.substring(
      spec.index + spec[0].length,
    )}`
    const messageMatch = this.startMatcher.exec(strWithoutSpec)
    if (messageMatch === null) {
      return null
    }

    const {
      type: jobTypeSpecifier,
      daySpec: jobDaySpecifier,
      timeSpec: jobTimeSpecifier1,
      timeSpec2: jobTimeSpecifier2,
    } = spec.groups ?? {}

    const { message } = messageMatch.groups ?? {}

    const messageInfo: JobMessageInfo = {
      message,
      room: envelope.room,
    }
    // Extract thread id if available.
    if (
      envelope.message instanceof MatrixMessage &&
      envelope.message.metadata.threadId !== undefined
    ) {
      messageInfo.threadId = envelope.message.metadata.threadId
    }

    // Match can be either for the day-included version or the no-day version.
    const jobTimeSpecifier = jobTimeSpecifier1 ?? jobTimeSpecifier2

    if (jobTypeSpecifier === "on") {
      return this.parseSingleSpec(
        messageInfo,
        jobDaySpecifier,
        jobTimeSpecifier,
      )
    }
    return this.parseRecurringSpec(
      messageInfo,
      jobDaySpecifier,
      jobTimeSpecifier,
    )
  }

  static intervalMatcher =
    /(?:(other|second|third|fourth|fifth|[0-9]{1,2}th) )?/

  static weekDayMatcher = new RegExp(
    "M(o(n(d(a(y)?)?)?)?)?|" +
      "Tu(e(s(d(a(y)?)?)?)?)?|" +
      "W(e(d(n(e(s(d(a(y)?)?)?)?)?)?)?)?|" +
      "Th(u(r(s(d(a(y)?)?)?)?)?)?|" +
      "F(r(i(d(a(y)?)?)?)?)?|" +
      "Sa(t(u(r(d(a(y)?)?)?)?)?)?|" +
      "Su(n(d(a(y)?)?)?)?",
  )

  static normalizeDayOfWeek(dayOfWeek: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
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

  static parseSingleSpec(
    messageInfo: JobMessageInfo,
    jobDaySpecifier: string,
    jobTimeSpecifier: string,
  ): SingleJob {
    // Start with today as the specified day.
    const specifiedDate = moment() // TODO Adapt to user timezone.

    const dayOfWeek = this.weekDayMatcher.exec(jobDaySpecifier)
    const daySpec =
      dayOfWeek !== null
        ? this.normalizeDayOfWeek(dayOfWeek[0])
        : specifiedDate.day()

    specifiedDate.set(moment(jobDaySpecifier).toObject())

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

    return {
      type: "single",
      messageInfo,
      spec: fullSpec,
      next: this.computeNextRecurrence(
        moment().subtract({ day: 1 }).toISOString(),
        {
          ...fullSpec,
          interval: 1,
          repeat: "week",
        },
      ),
    }
  }

  static normalizeInterval(interval: string): number {
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

  static parseRecurringSpec(
    messageInfo: JobMessageInfo,
    jobDaySpecifier: string,
    jobTimeSpecifier: string,
  ): RecurringJob {
    const interval = jobDaySpecifier.match(this.intervalMatcher)?.[1] ?? "1"
    const normalizedInterval = this.normalizeInterval(interval)
    const dayOfWeek = this.weekDayMatcher.exec(jobDaySpecifier)

    const daySpec =
      dayOfWeek === null
        ? // "every 5th" is the 5th day of the month.
          ({ repeat: "month", dayOfMonth: normalizedInterval } as const)
        : ({
            repeat: "week",
            interval: normalizedInterval,
            dayOfWeek: this.normalizeDayOfWeek(dayOfWeek[0]),
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

    return {
      type: "recurring",
      messageInfo,
      spec: fullSpec,
      next: this.computeNextRecurrence(
        moment().subtract({ day: 1 }).toISOString(),
        fullSpec,
      ),
    }
  }

  static computeNextRecurrence(
    previousRecurrenceISO: string,
    spec: RecurringSpec,
  ): string {
    const { repeat, hour, minute } = spec

    const repeatDate = moment(previousRecurrenceISO)

    if (repeat === "month") {
      const { dayOfMonth } = spec
      if (repeatDate.date() < dayOfMonth) {
        repeatDate.date(dayOfMonth)
      } else {
        repeatDate.add({ month: 1 }).date(dayOfMonth)
      }
    } else if (repeat === "week") {
      const { interval, dayOfWeek } = spec

      // FIXME Off by one here, saying "every Monday" on Monday will advance by
      // FIXME the interval instead of by 1. Probably need to resolve in
      // FIXME previousRecurrenceISO instead of special-casing in here.
      if (repeatDate.day() < dayOfWeek) {
        repeatDate.day(dayOfWeek)
      } else {
        repeatDate.add({ week: interval }).day(dayOfWeek)
      }
    }

    repeatDate.set({ hour, minute, second: 0, millisecond: 0 })

    return repeatDate.toISOString()
  }
}

export { Job }
