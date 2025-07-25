export type JobMessageInfo = {
	userId: string
	message: string
	room: string
	threadId?: string
}

export type BaseJobSpec<Type extends string, SpecType> = {
	type: Type
	spec: SpecType
}

export type BaseJobDefinition<Type extends string, SpecType> = BaseJobSpec<
	Type,
	SpecType
> & {
	messageInfo: JobMessageInfo
}

export type BaseJob<Type extends string, SpecType> = BaseJobDefinition<
	Type,
	SpecType
> & {
	next: string
}

export type JobSpec =
	| BaseJobSpec<"single", SingleShotDefinition>
	| BaseJobSpec<"recurring", RecurringDefinition>

export type JobDefinition =
	| BaseJobDefinition<"single", SingleShotDefinition>
	| BaseJobDefinition<"recurring", RecurringDefinition>

export type SingleJob = BaseJob<"single", SingleShotDefinition>
export type RecurringJob = BaseJob<"recurring", RecurringDefinition>

export type Job = SingleJob | RecurringJob

export type PersistedJob =
	| (SingleJob & { id: number })
	| (RecurringJob & { id: number })

export type SingleShotDefinition = {
	hour: number
	minute: number
	dayOfWeek: number | number[]
}

export type RecurringDefinition =
	| (SingleShotDefinition & {
			repeat: "week"
			interval: number
	  })
	| {
			hour: number
			minute: number
			repeat: "month"
			dayOfMonth: number
	  }

export type RecurrenceSpec = SingleShotDefinition | RecurringDefinition
