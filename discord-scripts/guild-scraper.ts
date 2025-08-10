import { Client, TextChannel, OverwriteType } from "discord.js"
import { Robot } from "hubot"
import axios from "axios"

export default async function guildScraper(
  discordClient: Client,
  robot: Robot,
): Promise<void> {
  const { application } = discordClient

  if (application) {
    robot.logger.info("Guild scraper loaded this info from connected guild")

    discordClient.guilds.cache.forEach(async (guild) => {
      try {
        const roles = await guild.roles.fetch()
        const webhookUrl = process.env.CODA_WEBHOOK_URL
        const apiToken = process.env.CODA_WEBHOOK_APIKEY

        if (typeof webhookUrl !== "string") {
          throw new Error("Webhook URL is not defined.")
        }

        if (typeof apiToken !== "string") {
          throw new Error("API Token is not defined.")
        }

        const rolesData = roles.map((role) => ({
          name: role.name,
          permissions: role.permissions.toArray(),
        }))

        robot.logger.info(
          "Collected roles data for guild ${guild.id}: ${JSON.stringify(rolesData)}",
        )

        await axios
          .post(webhookUrl, rolesData, {
            headers: {
              Authorization: `Bearer ${apiToken}`,
              "Content-Type": "application/json",
            },
          })
          .then(() =>
            robot.logger.info(
              `sent roles data to webhook for guild ${guild.id}`,
            ),
          )
          .catch((error: any) =>
            robot.logger.error(
              `error sending roles data to webhook for guild ${guild.id}:`,
              error,
            ),
          )
      } catch (error) {
        robot.logger.error(
          `error while scraping roles in guild ${guild.id}:`,
          error,
        )
      }
    })

    discordClient.channels.cache.forEach((channel) => {
      if (channel instanceof TextChannel) {
        robot.logger.info(`Channel name: ${channel.name}`)

        const rolePermissions: string[] = []

        channel.permissionOverwrites.cache.forEach((overwrite) => {
          if (overwrite.type === OverwriteType.Role) {
            const role = channel.guild.roles.cache.get(overwrite.id)
            if (role) {
              rolePermissions.push(role.name)
            }
          }
        })

        robot.logger.info(`Assigned roles: ${rolePermissions.join(", ")}`)
      }
    })
  }
}
