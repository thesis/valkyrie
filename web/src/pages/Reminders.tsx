import * as React from "react"
import { ScheduledJob } from "../../../lib/scheduled-jobs"
import App from "../../App"

export default function Reminders({
  reminders,
}: {
  reminders: ScheduledJob[]
}) {
  return (
    <App title="Reminders">
      <ul>
        {reminders.map((reminder) => (
          <li>
            <a href={}>{reminder.room}</a>: {reminder.message}
          </li>
        ))}
      </ul>
    </App>
  )
}
