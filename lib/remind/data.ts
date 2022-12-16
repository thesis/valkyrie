export type JobMessageInfo = {
  userId: string
  message: string
  room: string
  threadId?: string
}

export type BaseJobSpec<Type extends string, SpecType> = {
  type: Type
  messageInfo: JobMessageInfo
  spec: SpecType
}

export type BaseJob<Type extends string, SpecType> = BaseJobSpec<
  Type,
  SpecType
> & {
  next: string
}

export type JobSpec =
  | BaseJobSpec<"single", SingleShotSpec>
  | BaseJobSpec<"recurring", RecurringSpec>

export type SingleJob = BaseJob<"single", SingleShotSpec>
export type RecurringJob = BaseJob<"recurring", RecurringSpec>

export type Job = SingleJob | RecurringJob

export type SingleShotSpec = { hour: number; minute: number; dayOfWeek: number }

export type RecurringSpec =
  | (SingleShotSpec & {
      repeat: "week"
      interval: number
    })
  | {
      hour: number
      minute: number
      repeat: "month"
      dayOfMonth: number
    }
