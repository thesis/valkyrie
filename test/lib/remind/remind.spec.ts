import { describe, expect, test } from "@jest/globals"
import { parseSpec } from "../../../lib/remind/parsing"

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
    expect(parseSpec(str)?.jobSpec).toEqual(expectedSpec)
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
    expect(expectedSpec).toEqual(parseSpec(str)?.jobSpec)
  })
})
