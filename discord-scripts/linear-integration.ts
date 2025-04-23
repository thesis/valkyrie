import {
  ApplicationCommandOptionType,
  Client,
  EmbedBuilder,
  TextBasedChannel,
  TextChannel,
} from "discord.js"
import { LinearClient } from "@linear/sdk"
import { Robot } from "hubot"

const COMMAND_NAME = "linear-updates"
const CONNECT_SUBCOMMAND_NAME = "connect"
const DISCONNECT_SUBCOMMAND_NAME = "disconnect"
const { LINEAR_API_TOKEN, VALKYRIE_ROOT_URL } = process.env
const LINEAR_BRAIN_KEY = "linear"

const linearClient = new LinearClient({ apiKey: LINEAR_API_TOKEN })

const eventHandlers: Record<
  string,
  (data: any, channel: TextBasedChannel, robot: Robot) => Promise<void>
> = {
  ProjectUpdate: async ({ data, actor, url }, channel) => {
    const embed = new EmbedBuilder()
      .setTitle(`Project Update: ${data.project.name}`)
      .setDescription(data.body || "No description provided.")
      .setURL(url)
      .setAuthor({ name: actor.name, iconURL: actor.avatarUrl })
      .setTimestamp()

    await channel.send({ embeds: [embed] })
  },
}

async function createCustomWebhookUrl(
  channel: TextBasedChannel,
): Promise<string | null> {
  try {
    if (!(channel instanceof TextChannel)) {
      console.error("Webhook creation failed: Channel is not a TextChannel.")
      return null
    }

    const customWebhookUrl = `${VALKYRIE_ROOT_URL}linear-${channel.name
      .toLowerCase()
      .replace(/\s+/g, "-")}`

    console.log("Generated custom webhook URL:", customWebhookUrl)
    return customWebhookUrl
  } catch (error) {
    console.error("Error generating custom webhook URL:", error)
    return null
  }
}

async function fetchLinearTeams() {
  try {
    const teams = await linearClient.teams()
    return teams.nodes.map((team) => ({ id: team.id, name: team.name }))
  } catch (error) {
    console.error("Error fetching Linear teams:", error)
    return []
  }
}

export default async function linearIntegration(
  discordClient: Client,
  robot: Robot,
) {
  robot.logger.info("Configuring Linear integration...")

  const { application } = discordClient
  if (!application) {
    robot.logger.error(
      "Failed to resolve Discord application, dropping Linear handling.",
    )
    return
  }

  const existingLinearCommand = (await application.commands.fetch()).find(
    (command) => command.name === COMMAND_NAME,
  )

  if (!existingLinearCommand) {
    robot.logger.info("No linear command found, creating it!")

    const teams = await fetchLinearTeams()

    await application.commands.set([])
    await application.commands.create({
      name: COMMAND_NAME,
      description: "Manage Linear project notifications in this channel.",
      options: [
        {
          name: CONNECT_SUBCOMMAND_NAME,
          type: ApplicationCommandOptionType.Subcommand,
          description: "Connects a Linear team to this channel.",
          options: [
            {
              name: "team",
              type: ApplicationCommandOptionType.String,
              description: "The ID of the Linear team to connect.",
              required: true,
              choices: teams.map((team) => ({
                name: team.name,
                value: team.id,
              })),
            },
          ],
        },
        {
          name: DISCONNECT_SUBCOMMAND_NAME,
          type: ApplicationCommandOptionType.Subcommand,
          description: "Disconnects a Linear team from this channel.",
          options: [
            {
              name: "team",
              type: ApplicationCommandOptionType.String,
              description: "The ID of the Linear team to disconnect.",
              required: true,
              choices: teams.map((team) => ({
                name: team.name,
                value: team.id,
              })),
            },
          ],
        },
      ],
    })
    robot.logger.info("Created linear command.")
  }

  discordClient.on("interactionCreate", async (interaction) => {
    robot.logger.info("Received interaction:", interaction)
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === COMMAND_NAME
    ) {
      robot.logger.info("Running command")
      const subcommand = interaction.options.getSubcommand()
      const teamId = interaction.options.getString("team")

      if (!teamId) {
        await interaction.reply({
          content: "Please provide a valid team ID.",
          ephemeral: true,
        })
        return
      }

      const existingConnections =
        robot.brain.get(LINEAR_BRAIN_KEY)?.connections ?? {}

      if (subcommand === CONNECT_SUBCOMMAND_NAME) {
        const { channel } = interaction
        if (!channel || !channel.isTextBased()) {
          await interaction.reply({
            content: "Invalid channel.",
            ephemeral: true,
          })
          return
        }

        await interaction.reply({
          content: "Linked this channel",
          ephemeral: true,
        })

        robot.logger.info("Creating custom webhook URL for team:", teamId)
        const customWebhookUrl = await createCustomWebhookUrl(channel)

        if (customWebhookUrl) {
          const createdWebhook = await linearClient.createWebhook({
            url: customWebhookUrl,
            teamId,
            resourceTypes: ["ProjectUpdate"],
            enabled: true,
          })

          existingConnections[teamId] = {
            webhookUrl: customWebhookUrl,
            linearWebhookId: createdWebhook.webhook,
          }
          robot.brain.set(LINEAR_BRAIN_KEY, {
            connections: existingConnections,
          })

          await interaction.editReply({
            content: `Connected Linear team **${teamId}** to this channel with a custom webhook URL.`,
          })
        } else {
          await interaction.editReply({
            content: `Failed to generate custom webhook URL for team ${teamId}.`,
          })
        }
      } else if (subcommand === DISCONNECT_SUBCOMMAND_NAME) {
        const connection = existingConnections[teamId]

        if (connection?.linearWebhookId) {
          try {
            let webhookId = connection.linearWebhookId

            if (webhookId && typeof webhookId === "object" && webhookId.then) {
              webhookId = await webhookId
            }

            if (typeof webhookId === "string") {
              await linearClient.deleteWebhook(webhookId)
              robot.logger.info(
                `Deleted Linear webhook ${webhookId} for team ${teamId}`,
              )
            } else {
              robot.logger.error(
                `Invalid webhook ID for team ${teamId}:`,
                webhookId,
              )
            }
          } catch (err) {
            robot.logger.error(
              `Failed to delete Linear webhook for team ${teamId}:`,
              err,
            )
          }
        }

        delete existingConnections[teamId]
        robot.brain.set(LINEAR_BRAIN_KEY, { connections: existingConnections })

        await interaction.reply({
          content: `Disconnected Linear team **${teamId}** and removed webhook.`,
          ephemeral: true,
        })
      }
    }
  })
  robot.router.post(/^\/linear-(.+)/, async (req, res) => {
    try {
      const channelName = req.params[0]
      const connections = robot.brain.get(LINEAR_BRAIN_KEY)?.connections ?? {}
      const eventData = req.body
      robot.logger.info("Webhook payload:", JSON.stringify(eventData, null, 2))

      const guilds = discordClient.guilds.cache
      let matchedChannel: TextBasedChannel | null = null

      for (const [, guild] of guilds) {
        const channels = await guild.channels.fetch()
        const match = channels.find(
          (ch) =>
            ch?.isTextBased?.() &&
            ch.name.toLowerCase().replace(/\s+/g, "-") === channelName,
        )
        if (match?.isTextBased?.()) {
          matchedChannel = match
          break
        }
      }

      if (!matchedChannel) {
        robot.logger.error(`No matching channel found for name: ${channelName}`)
        res.writeHead(404).end("Channel not found.")
        return
      }

      const eventType = eventData?.type
      if (!eventType || !eventHandlers[eventType]) {
        robot.logger.error(`Unhandled or missing event type: ${eventType}`)
        res.writeHead(200).end("Event ignored.")
        return
      }

      await eventHandlers[eventType](eventData, matchedChannel, robot)

      res.writeHead(200).end("Event processed.")
    } catch (err) {
      robot.logger.error("Error handling Linear webhook:", err)
      res.writeHead(500).end("Internal error.")
    }
  })
}
