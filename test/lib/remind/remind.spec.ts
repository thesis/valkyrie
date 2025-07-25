import { afterEach, describe, expect, jest, test } from "@jest/globals"
import { computeNextRecurrence } from "../../../lib/remind/index.ts"
import { parseSpec } from "../../../lib/remind/parsing.ts"

afterEach(() => {
	jest.useRealTimers()
})

describe("reminder scheduling", () => {
	const monthlyDefinition = {
		repeat: "month",
		hour: 15,
		minute: 13,
		dayOfMonth: 2,
	} as const

	test.each([
		{
			name: "with previous recurrence exactly one month before",
			previousRecurrenceISO: "2022-12-02T15:13:00Z",
			expectedNextRecurrenceISO: "2023-01-02T15:13:00.000Z",
		},
		{
			name: "with previous recurrence one minute before",
			previousRecurrenceISO: "2022-12-02T15:12:00Z",
			expectedNextRecurrenceISO: "2022-12-02T15:13:00.000Z",
		},
		{
			name: "with previous recurrence one minute after",
			previousRecurrenceISO: "2022-12-02T15:14:00Z",
			expectedNextRecurrenceISO: "2023-01-02T15:13:00.000Z",
		},
		{
			name: "with previous recurrence one hour before",
			previousRecurrenceISO: "2022-12-02T14:13:00Z",
			expectedNextRecurrenceISO: "2022-12-02T15:13:00.000Z",
		},
		{
			name: "with previous recurrence one hour after",
			previousRecurrenceISO: "2022-12-02T16:13:00Z",
			expectedNextRecurrenceISO: "2023-01-02T15:13:00.000Z",
		},
		{
			name: "with previous recurrence one day before",
			previousRecurrenceISO: "2022-12-01T15:13:00Z",
			expectedNextRecurrenceISO: "2022-12-02T15:13:00.000Z",
		},
	] as const)(
		"supports monthly specs $name",
		({ previousRecurrenceISO, expectedNextRecurrenceISO }) => {
			expect(
				computeNextRecurrence(previousRecurrenceISO, monthlyDefinition),
			).toEqual(expectedNextRecurrenceISO)
		},
	)

	const weeklyDefinition = {
		repeat: "week",
		dayOfWeek: 2,
		interval: 1,
		hour: 16,
		minute: 33,
	} as const

	const weeklyBaseDate = "2022-12-06" // A Tuesday, dayOfWeek: 2.

	test.each([
		{
			name: "with previous recurrence exactly one week before",
			previousRecurrenceISO: "2022-11-29T16:33:00Z",
			expectedNextRecurrenceISO: `${weeklyBaseDate}T16:33:00.000Z`,
		},
		{
			name: "with previous recurrence one minute before",
			previousRecurrenceISO: `${weeklyBaseDate}T16:32:00Z`,
			expectedNextRecurrenceISO: `${weeklyBaseDate}T16:33:00.000Z`,
		},
		{
			name: "with previous recurrence one minute after",
			previousRecurrenceISO: `${weeklyBaseDate}T16:34:00Z`,
			expectedNextRecurrenceISO: "2022-12-13T16:33:00.000Z",
		},
		{
			name: "with previous recurrence one day before",
			previousRecurrenceISO: "2022-12-05T15:13:00Z",
			expectedNextRecurrenceISO: `${weeklyBaseDate}T16:33:00.000Z`,
		},
	] as const)(
		"supports weekly specs $name",
		({ previousRecurrenceISO, expectedNextRecurrenceISO }) => {
			expect(
				computeNextRecurrence(previousRecurrenceISO, weeklyDefinition),
			).toEqual(expectedNextRecurrenceISO)
		},
	)

	const weeklyMultiDayDefiniton = {
		...weeklyDefinition,
		dayOfWeek: [1, 2, 3, 4, 5],
	}

	test.each([
		{
			name: "with previous recurrence before the first day",
			previousRecurrenceISO: "2022-12-03T16:33:00Z",
			expectedNextRecurrenceISO: "2022-12-05T16:33:00.000Z",
		},
		{
			name: "with previous recurrence on a recurrence day one minute before",
			previousRecurrenceISO: `${weeklyBaseDate}T16:32:00Z`,
			expectedNextRecurrenceISO: `${weeklyBaseDate}T16:33:00.000Z`,
		},
		{
			name: "with previous recurrence on a recurrence day one minute after",
			previousRecurrenceISO: `${weeklyBaseDate}T16:34:00Z`,
			expectedNextRecurrenceISO: "2022-12-07T16:33:00.000Z",
		},
		{
			name: "with previous recurrence after the last day",
			previousRecurrenceISO: "2022-12-10T16:33:00Z",
			expectedNextRecurrenceISO: "2022-12-12T16:33:00.000Z",
		},
	] as const)(
		"supports weekly specs on multiple days $name",
		({ previousRecurrenceISO, expectedNextRecurrenceISO }) => {
			expect(
				computeNextRecurrence(previousRecurrenceISO, weeklyMultiDayDefiniton),
			).toEqual(expectedNextRecurrenceISO)
		},
	)

	const weeklyIntervalDefinition = {
		repeat: "week",
		dayOfWeek: 2,
		interval: 2,
		hour: 16,
		minute: 33,
	} as const

	test.each([
		{
			name: "with previous recurrence one minute before on recurrence day",
			previousRecurrenceISO: `${weeklyBaseDate}T16:32:00Z`,
			expectedNextRecurrenceISO: `${weeklyBaseDate}T16:33:00.000Z`,
		},
		{
			name: "with previous recurrence one minute after on recurrence day",
			previousRecurrenceISO: `${weeklyBaseDate}T16:34:00Z`,
			expectedNextRecurrenceISO: "2022-12-20T16:33:00.000Z",
		},
		{
			name: "with previous recurrence one day before recurrence day",
			previousRecurrenceISO: "2022-12-05T15:13:00Z",
			expectedNextRecurrenceISO: `${weeklyBaseDate}T16:33:00.000Z`,
		},
		{
			name: "with previous recurrence on the recurrence day",
			previousRecurrenceISO: `${weeklyBaseDate}T15:13:00Z`,
			expectedNextRecurrenceISO: `${weeklyBaseDate}T16:33:00.000Z`,
		},
	] as const)(
		"supports every-other-weekly specs $name",
		({ previousRecurrenceISO, expectedNextRecurrenceISO }) => {
			expect(
				computeNextRecurrence(previousRecurrenceISO, weeklyIntervalDefinition),
			).toEqual(expectedNextRecurrenceISO)
		},
	)

	const weeklyThreetervalDefinition = {
		repeat: "week",
		dayOfWeek: 2,
		interval: 3,
		hour: 16,
		minute: 33,
	} as const

	test.each([
		{
			name: "with previous recurrence one minute before on recurrence day",
			previousRecurrenceISO: `${weeklyBaseDate}T16:32:00Z`,
			expectedNextRecurrenceISO: `${weeklyBaseDate}T16:33:00.000Z`,
		},
		{
			name: "with previous recurrence one minute after on recurrence day",
			previousRecurrenceISO: `${weeklyBaseDate}T16:34:00Z`,
			expectedNextRecurrenceISO: "2022-12-27T16:33:00.000Z",
		},
		{
			name: "with previous recurrence one day before recurrence day",
			previousRecurrenceISO: "2022-12-05T15:13:00Z",
			expectedNextRecurrenceISO: `${weeklyBaseDate}T16:33:00.000Z`,
		},
		{
			name: "with previous recurrence on the recurrence day",
			previousRecurrenceISO: `${weeklyBaseDate}T15:13:00Z`,
			expectedNextRecurrenceISO: `${weeklyBaseDate}T16:33:00.000Z`,
		},
	] as const)(
		"supports every-third-weekly specs $name",
		({ previousRecurrenceISO, expectedNextRecurrenceISO }) => {
			expect(
				computeNextRecurrence(
					previousRecurrenceISO,
					weeklyThreetervalDefinition,
				),
			).toEqual(expectedNextRecurrenceISO)
		},
	)
})

describe("reminder spec parsing", () => {
	const monthlySpec = {
		type: "recurring",
		spec: { repeat: "month", dayOfMonth: 5, hour: 0, minute: 0 },
	}

	const weeklyDefinition = {
		repeat: "week",
		dayOfWeek: 2,
		interval: 1,
		hour: 16,
		minute: 33,
	}

	const weeklySpec = {
		type: "recurring",
		spec: weeklyDefinition,
	}

	test.each([
		{
			name: "in the middle",
			str: "remind me every 5th to do things",
			expectedSpec: monthlySpec,
		},
		{
			name: "at the end",
			str: "remind me to do things every 5th",
			expectedSpec: monthlySpec,
		},
		{
			name: "in the middle without ordinal",
			str: "remind me every 5 to do things",
			expectedSpec: monthlySpec,
		},
		{
			name: "at the end without ordinal",
			str: "remind me to do things every 5",
			expectedSpec: monthlySpec,
		},
		{
			name: "in the middle with day-of-month",
			str: "remind me every 5th day of the month to do things",
			expectedSpec: monthlySpec,
		},
		{
			name: "at the end with day-of-month",
			str: "remind me every 5th day of the month to do things",
			expectedSpec: monthlySpec,
		},
	])("supports monthly specs $name", ({ str, expectedSpec }) => {
		expect(parseSpec(str, "utc")?.jobSpec).toEqual(expectedSpec)
	})

	test.each([
		{
			name: "in the middle",
			str: "remind me every Tuesday at 16:33 to do things",
			expectedSpec: weeklySpec,
		},
		{
			name: "at the end",
			str: "remind me to do things every Tuesday at 16:33",
			expectedSpec: weeklySpec,
		},
		{
			name: "in the middle with skipping",
			str: "remind me every second Tuesday at 16:33 to do things",
			expectedSpec: {
				...weeklySpec,
				spec: { ...weeklyDefinition, interval: 2 },
			},
		},
		{
			name: "at the end with skipping",
			str: "remind me to do things every second Tuesday at 16:33",
			expectedSpec: {
				...weeklySpec,
				spec: { ...weeklyDefinition, interval: 2 },
			},
		},
		{
			name: "in the middle with ordinal skipping",
			str: "remind me every 2nd Tuesday at 16:33 to do things",
			expectedSpec: {
				...weeklySpec,
				spec: { ...weeklyDefinition, interval: 2 },
			},
		},
		{
			name: "at the end with ordinal skipping",
			str: "remind me to do things every 2nd Tuesday at 16:33",
			expectedSpec: {
				...weeklySpec,
				spec: { ...weeklyDefinition, interval: 2 },
			},
		},
		{
			name: "in the middle with count skipping",
			str: "remind me every 2 Tuesdays at 16:33 to do things",
			expectedSpec: {
				...weeklySpec,
				spec: { ...weeklyDefinition, interval: 2 },
			},
		},
		{
			name: "at the end with count skipping",
			str: "remind me to do things every 2 Tuesdays at 16:33",
			expectedSpec: {
				...weeklySpec,
				spec: { ...weeklyDefinition, interval: 2 },
			},
		},
	])("supports weekly specs $name", ({ str, expectedSpec }) => {
		expect(expectedSpec).toEqual(parseSpec(str, "utc")?.jobSpec)
	})

	test.each([
		{
			name: "in the middle",
			str: "remind me every weekday at 16:33 to do things",
			expectedSpec: {
				...weeklySpec,
				spec: { ...weeklySpec.spec, dayOfWeek: [1, 2, 3, 4, 5] },
			},
		},
		{
			name: "at the end",
			str: "remind me to do things every weekday at 16:33",
			expectedSpec: {
				...weeklySpec,
				spec: { ...weeklySpec.spec, dayOfWeek: [1, 2, 3, 4, 5] },
			},
		},
	])("supports weekly specs for weekdays $name", ({ str, expectedSpec }) => {
		expect(expectedSpec).toEqual(parseSpec(str, "utc")?.jobSpec)
	})

	const baseDate = "2022-12-02" // A Friday
	const baseTime = "16:33:00Z"

	const baseSingleSpec = {
		type: "single",
		spec: {
			dayOfWeek: 5,
			hour: 16,
			minute: 33, // base + 5
		},
	}

	test.each([
		{
			name: "in the middle in hours",
			str: "remind me in an hour to do things",
			expectedSpec: {
				...baseSingleSpec,
				spec: { ...baseSingleSpec.spec, hour: 17 },
			},
		},
		{
			name: "at the end in hours",
			str: "remind me to do things in 1 hour",
			expectedSpec: {
				...baseSingleSpec,
				spec: { ...baseSingleSpec.spec, hour: 17 },
			},
		},
		{
			name: "in the middle in minutes",
			str: "remind me in 5 minutes to do things",
			expectedSpec: {
				...baseSingleSpec,
				spec: { ...baseSingleSpec.spec, minute: 38 },
			},
		},
		{
			name: "at the end in minutes",
			str: "remind me to do things in five minutes",
			expectedSpec: {
				...baseSingleSpec,
				spec: { ...baseSingleSpec.spec, minute: 38 },
			},
		},
		{
			name: "in the middle in days",
			str: "remind me in 6 days to do things",
			expectedSpec: {
				...baseSingleSpec,
				spec: { ...baseSingleSpec.spec, dayOfWeek: 11 },
			},
		},
		{
			name: "at the end in days",
			str: "remind me to do things in 6 days",
			expectedSpec: {
				...baseSingleSpec,
				spec: { ...baseSingleSpec.spec, dayOfWeek: 11 },
			},
		},
		{
			name: "in the middle as 'next <day>'",
			str: "remind me next Tuesday to do things",
			expectedSpec: {
				...baseSingleSpec,
				spec: { ...baseSingleSpec.spec, dayOfWeek: 2, hour: 0, minute: 0 },
			},
		},
		{
			name: "at the end as 'next <day>'",
			str: "remind me to do things next Thursday",
			expectedSpec: {
				...baseSingleSpec,
				spec: { ...baseSingleSpec.spec, dayOfWeek: 4, hour: 0, minute: 0 },
			},
		},
		{
			name: "in the middle as 'on <day>'",
			str: "remind me on Tuesday to do things",
			expectedSpec: {
				...baseSingleSpec,
				spec: { ...baseSingleSpec.spec, dayOfWeek: 2, hour: 0, minute: 0 },
			},
		},
		{
			name: "at the end as 'on <day>'",
			str: "remind me to do things next Thursday",
			expectedSpec: {
				...baseSingleSpec,
				spec: { ...baseSingleSpec.spec, dayOfWeek: 4, hour: 0, minute: 0 },
			},
		},
	])("supports relative specs $name", ({ str, expectedSpec }) => {
		jest.useFakeTimers({ now: new Date(`${baseDate}T${baseTime}`) })

		expect(expectedSpec).toEqual(parseSpec(str, "utc")?.jobSpec)
	})

	const baseSingleTimeSpec = {
		...baseSingleSpec,
		spec: { ...baseSingleSpec.spec, hour: 13, minute: 12 },
	}

	test.each([
		{
			name: "in the middle in days",
			str: "remind me in 6 days at 13:12 to do things",
			expectedSpec: {
				...baseSingleTimeSpec,
				spec: { ...baseSingleTimeSpec.spec, dayOfWeek: 11 },
			},
		},
		{
			name: "at the end in days",
			str: "remind me to do things in 6 days at 13:12",
			expectedSpec: {
				...baseSingleTimeSpec,
				spec: { ...baseSingleTimeSpec.spec, dayOfWeek: 11 },
			},
		},
		{
			name: "in the middle as 'next <day>'",
			str: "remind me next Tuesday at 13:12 to do things",
			expectedSpec: {
				...baseSingleTimeSpec,
				spec: { ...baseSingleTimeSpec.spec, dayOfWeek: 2 },
			},
		},
		{
			name: "at the end as 'next <day>'",
			str: "remind me to do things next Thursday at 13:12",
			expectedSpec: {
				...baseSingleTimeSpec,
				spec: { ...baseSingleTimeSpec.spec, dayOfWeek: 4 },
			},
		},
		{
			name: "in the middle as 'on <day>'",
			str: "remind me on Tuesday at 13:12 to do things",
			expectedSpec: {
				...baseSingleTimeSpec,
				spec: { ...baseSingleTimeSpec.spec, dayOfWeek: 2 },
			},
		},
		{
			name: "at the end as 'on <day>'",
			str: "remind me to do things next Thursday at 13:12",
			expectedSpec: {
				...baseSingleTimeSpec,
				spec: { ...baseSingleTimeSpec.spec, dayOfWeek: 4 },
			},
		},
	])("supports relative specs with time $name", ({ str, expectedSpec }) => {
		jest.useFakeTimers({ now: new Date(`${baseDate}T${baseTime}`) })

		expect(parseSpec(str, "utc")?.jobSpec).toEqual(expectedSpec)
	})
})
