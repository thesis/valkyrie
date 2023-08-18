import fs from "fs"
import { Client } from "discord.js"
import path from "path"
import { Robot } from "hubot"
import { fileURLToPath } from "url"
import { DiscordEventHandlers } from "../lib/discord/utils.ts"

export default function manageThreads(discordClient: Client, robot: Robot) {
  fs.readdirSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "./thread-management",
    ),
  )
    .sort()
    .filter(
      (file) =>
        [".ts", ".js"].includes(path.extname(file)) && !file.startsWith("_"),
    )
    .forEach(async (file) => {
      try {
        const threadManagementScript: { default: DiscordEventHandlers } =
          await import(
            path.join("..", "discord-scripts", "thread-management", file)
          )

        Object.entries(threadManagementScript.default).forEach(
          ([event, handler]) => {
            discordClient.on(event, (...args) => {
              const finalArgs = [...args, robot]
              // @ts-expect-error We are doing some shenanigans here that TS can't
              // handle to always pass a robot as the last parameter to the
              // handler.
              return handler(...finalArgs)
            })
          },
        )

        if ("setup" in threadManagementScript) {
          ;(
            threadManagementScript.setup as (
              robot: Robot,
              client: Client,
            ) => Promise<void>
          ).call(undefined, robot, discordClient)
        }

        robot.logger.info(`Loaded Discord thread management script ${file}.`)
      } catch (error) {
        const stackString =
          // Errors may have a stack trace, or not---anyone's guess!
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "stack" in (error as any) ? `\n${(error as any).stack}` : ""

        robot.logger.error(
          `Failed to load Discord script ${file}: ${JSON.stringify(
            error,
            null,
            2,
          )}${stackString}`,
        )
      }
    })
}
