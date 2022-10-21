// eslint-disable-next-line import/no-cycle
import Job from "./Job"

export type ScheduledJob = Job

export type ScheduledJobMap = {
  [jobId: string]: ScheduledJob
}
