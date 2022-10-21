export enum MeetingScheduleCategory {
  LIVE = "live",
  SCHEDULED = "scheduled",
  UPCOMING = "upcoming",
}

enum MeetingType {
  Instant = 1,
  Scheduled = 2,
  FloatingRecurring = 3,
  FixedRecurring = 8,
}

export type Meeting = {
  id: string
  topic: string
  type: MeetingType
  agenda: string
  start_time: string
  join_url: string
  encrypted_password?: string
  app_url?: string
}
