import * as hubot from "hubot"
import { getRoomNameFromId } from "./adapter-util"
import Job from "./Job"
import {
  CONFIG,
  formatJobForMessage,
  isCronPattern,
  isRestrictedRoom,
  logSerializedJobDetails,
  updateJobInBrain,
} from "./schedule-util"
import {
  JobUser,
  MessageMetadata,
  ScheduledJob,
  ScheduledJobMap,
} from "./scheduled-jobs"
import processTemplateString from "./template-strings"

const JOB_MAX_COUNT = 10000

function startScheduledJob(
  robot: hubot.Robot<hubot.Adapter>,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  id: string,
  pattern: string,
  user: JobUser,
  room: string,
  message: string,
  cb: (() => void) | undefined,
  metadata: MessageMetadata,
  remindInThread: boolean,
) {
  // if a targetRoom isn't specified, send to current room
  // eslint-disable-next-line no-param-reassign
  room ??= user.room as string
  const job = new Job(
    id,
    pattern,
    user,
    room,
    message,
    cb,
    metadata,
    remindInThread,
  )
  job.start(robot)
  // eslint-disable-next-line no-param-reassign
  jobsInMemory[id] = job
  // eslint-disable-next-line no-param-reassign, no-return-assign
  return (robot.brain.get(storageKey)[id] = job.serialize())
}

function scheduleNewJob(
  robot: hubot.Robot<hubot.Adapter>,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  id: string,
  pattern: string,
  user: JobUser,
  room: string,
  message: string,
  metadata: MessageMetadata,
  remindInThread: boolean,
) {
  let cb
  let revisedPattern = pattern

  if (!isCronPattern(pattern)) {
    const date = Date.parse(pattern)
    if (!Number.isNaN(date)) {
      if (date < Date.now()) {
        throw new Error(`"${pattern}" has already passed.`)
      }
      revisedPattern = new Date(pattern).toString()
      cb = function updateJobsInMemory() {
        // eslint-disable-next-line no-param-reassign
        delete jobsInMemory[id]
        // eslint-disable-next-line no-param-reassign
        return delete robot.brain.get(storageKey)[id]
      }
    } else {
      // these errors should be handled in the scripts, this is a fallback
      throw new Error(`"${pattern}" is an invalid pattern.`)
    }
  }

  return startScheduledJob(
    robot,
    jobsInMemory,
    storageKey,
    id,
    revisedPattern,
    user,
    room,
    message,
    cb,
    metadata,
    remindInThread,
  )
}

function createScheduledJob(
  robot: hubot.Robot,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  user: JobUser,
  room: string,
  pattern: string,
  message: string,
  metadata: MessageMetadata,
  remindInThread: boolean,
): string {
  let id
  if (JOB_MAX_COUNT <= Object.keys(jobsInMemory).length) {
    return "Too many scheduled messages."
  }

  while (id == null || jobsInMemory[id]) {
    id = Math.floor(Math.random() * JOB_MAX_COUNT)
  }
  try {
    // Make sure template string, if present, is valid, but do not save return.
    // The job is not yet created at this point, so we pass an empty object.
    processTemplateString(message, robot.brain, {})

    const formattedJob = formatJobForMessage(
      robot.adapter,
      pattern,
      isCronPattern(pattern),
      id.toString(),
      message,
      room,
      metadata,
      remindInThread,
    )

    const job = scheduleNewJob(
      robot,
      jobsInMemory,
      storageKey,
      id.toString(),
      pattern,
      user,
      room,
      message,
      metadata,
      remindInThread,
    )

    logSerializedJobDetails(robot.logger, job, "New job created", id.toString())
    return `Schedule created:\n${formattedJob}`
  } catch (err) {
    robot.logger.error(err)
    return `There was an issue trying to create this schedule/ reminder: ${
      err instanceof Error ? err.message : "(unknown error)"
    }.`
  }
}

function updateScheduledJob(
  robot: hubot.Robot<hubot.Adapter>,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  msg: string,
  id: string,
  message: string,
) {
  const job = jobsInMemory[id]
  if (!job) {
    return `Schedule ${id} not found.`
  }

  if (isRestrictedRoom(job.user.room as string, msg)) {
    return `Updating schedule for the ${
      getRoomNameFromId(robot.adapter, job.user.room) || job.user.room
    } flow is restricted.`
  }

  job.message = message

  const serializedJob = updateJobInBrain(robot.brain, storageKey, job)
  logSerializedJobDetails(robot.logger, serializedJob, "Updated job", id)

  const formattedJob = formatJobForMessage(
    robot.adapter,
    job.pattern,
    isCronPattern(job.pattern),
    job.id,
    job.message,
    job.user.room as string,
    job.metadata,
    job.remindInThread,
  )
  return `Schedule message updated:\n${formattedJob}`
}

function cancelScheduledJob(
  robot: hubot.Robot<hubot.Adapter>,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  msg: string,
  id: string,
) {
  const job = jobsInMemory[id]
  if (!job) {
    return `${id}: Schedule not found.`
  }

  if (isRestrictedRoom(job.user.room as string, msg)) {
    return `Canceling schedule for the ${
      getRoomNameFromId(robot.adapter, job.user.room) || job.user.room
    } flow is restricted.`
  }

  job.cancel()
  // eslint-disable-next-line no-param-reassign
  delete jobsInMemory[id]
  // eslint-disable-next-line no-param-reassign
  delete robot.brain.get(storageKey)[id]

  logSerializedJobDetails(robot.logger, job.serialize(), "Cancelled job", id)

  const formattedJob = formatJobForMessage(
    robot.adapter,
    job.pattern,
    isCronPattern(job.pattern),
    job.id,
    job.message,
    job.user.room as string,
    job.metadata,
    job.remindInThread,
  )
  return `Schedule canceled:\n${formattedJob}`
}

function scheduleFromBrain(
  robot: hubot.Robot<hubot.Adapter>,
  jobsInMemory: ScheduledJobMap,
  storageKey: string,
  id: string,
  pattern: string,
  user: JobUser,
  message: string,
  metadata: MessageMetadata,
  remindInThread = false, // jobs missing this param are likely schedule cron jobs
) {
  try {
    scheduleNewJob(
      robot,
      jobsInMemory,
      storageKey,
      id,
      pattern,
      user,
      user.room as string /* making some assumptions here */,
      message,
      metadata,
      remindInThread,
    )
    if (CONFIG.debug === "1") {
      robot.logger.info(`${id} scheduled from brain.`)
    }
  } catch (error) {
    if (CONFIG.debug === "1") {
      robot.logger.error(
        `${id}: Failed to schedule from brain. [${
          error instanceof Error ? error.message : "(unknown error)"
        }] [${pattern}] [${message}]`,
      )
    }
    // eslint-disable-next-line no-param-reassign
    delete robot.brain.get(storageKey)[id]
  }
}

function missingKeys<A extends ScheduledJobMap, B extends ScheduledJobMap>(
  obj1: A,
  obj2: B,
): string[] {
  const diff: string[] = []
  Object.keys(obj1).forEach((id) => {
    if (!(id in obj2)) {
      diff.push(id)
    }
  })
  return diff
}

function storeScheduleInBrain(
  robot: hubot.Robot<hubot.Adapter>,
  storageKey: string,
  id: string,
  job: ScheduledJob,
) {
  // eslint-disable-next-line no-param-reassign
  robot.brain.get(storageKey)[id] = job.serialize()

  if (CONFIG.debug === "1") {
    robot.logger.info(`${id}: Schedule stored in brain asynchronously.`)
  }
}

function syncSchedules(
  robot: hubot.Robot<hubot.Adapter>,
  storageKey: string,
  jobsInMemory: ScheduledJobMap,
) {
  if (!robot.brain.get(storageKey)) {
    robot.brain.set(storageKey, {})
  }
  const nonCachedScheduleIds = missingKeys(
    robot.brain.get(storageKey),
    jobsInMemory,
  )
  nonCachedScheduleIds.forEach((id) => {
    const jobData = robot.brain.get(storageKey)[id] as ReturnType<
      Job["serialize"]
    >
    scheduleFromBrain(robot, jobsInMemory, storageKey, id, ...jobData)

    logSerializedJobDetails(robot.logger, jobData, "Synced job FROM brain", id)
  })

  const nonStoredScheduleIds = missingKeys(
    jobsInMemory,
    robot.brain.get(storageKey),
  )
  return (() => {
    const result: void[] = []

    nonStoredScheduleIds.forEach((id) => {
      const job = jobsInMemory[id]
      result.push(storeScheduleInBrain(robot, storageKey, id, job))

      logSerializedJobDetails(
        robot.logger,
        job.serialize(),
        "Synced job TO brain",
        id,
      )
    })

    return result
  })()
}

export {
  syncSchedules,
  createScheduledJob,
  updateScheduledJob,
  cancelScheduledJob,
}
