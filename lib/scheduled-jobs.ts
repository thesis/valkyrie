import * as scheduler from "node-schedule"
import * as hubot from "hubot"

export type MessageMetadata = {
  threadId?: string
  messageId: string
  lastUrl?: string
}

export type JobUser = Pick<hubot.User, "id" | "name"> & { room: string }

export interface ScheduledJob {
  id: string
  pattern: string
  room: string
  message: string
  metadata: MessageMetadata
  remindInThread: boolean
  user: JobUser
  job?: scheduler.Job

  isCron(): boolean
  serialize(): readonly [string, JobUser, string, MessageMetadata, boolean]
  cancel(): void
}

export type ScheduledJobMap = {
  [jobId: string]: ScheduledJob
}
