import {
  ApplicationCommandOptionType,
  Client,
  EmbedBuilder,
  TextBasedChannel,
  TextChannel,
} from "discord.js"
import { LinearClient } from "@linear/sdk"
import { Robot } from "hubot"
import crypto from "crypto"

const COMMAND_NAME = "linear-updates"
const CONNECT_SUBCOMMAND_NAME = "connect"
const DISCONNECT_SUBCOMMAND_NAME = "disconnect"
// Remember to set the VALKYRIE_WEBHOOK_URL to the endpoint for Linear to access, this should be the Root URL.
const { LINEAR_API_TOKEN, VALKYRIE_WEBHOOK_URL } = process.env
const LINEAR_BRAIN_KEY = "linear"

const linearClient = new LinearClient({ apiKey: LINEAR_API_TOKEN })
/* eslint-disable @typescript-eslint/no-explicit-any */
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
function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-")
}
/* eslint-enable @typescript-eslint/no-explicit-any */
async function createCustomWebhookUrl(
  channel: TextBasedChannel,
  robot: Robot,
): Promise<string | null> {
  try {
    if (!(channel instanceof TextChannel)) {
      console.error("Webhook creation failed: Channel is not a TextChannel.")
      return null
    }

    const randomId = Math.floor(100000 + Math.random() * 900000)
    const channelName = sanitizeName(channel.name)
    const customWebhookUrl = `${VALKYRIE_WEBHOOK_URL}linear/webhook/${channelName}-${randomId}`

    robot.logger.info("Generated custom webhook URL:", customWebhookUrl)
    return customWebhookUrl
  } catch (error) {
    robot.logger.error("Error generating custom webhook URL:", error)
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
  if (!LINEAR_API_TOKEN) {
    robot.logger.error(
      "Linear API token is not set. aborting Linear integration.",
    )
    return
  }

  if (!VALKYRIE_WEBHOOK_URL) {
    robot.logger.error(
      "No Valkyrie Webhook URL being set, aborting Linear integration.",
    )
    return
  }

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
        if (!(channel instanceof TextChannel)) {
          await interaction.reply({
            content: "This command must be used in a text channel.",
            ephemeral: true,
          })
          return
        }
        if (
          existingConnections[teamId] &&
          existingConnections[teamId][channel.id]
        ) {
          await interaction.reply({
            content:
              "⚠️ This Linear team is already connected to this channel.",
            ephemeral: true,
          })
          return
        }
        await interaction.reply({
          content: `Connecting project updates to this channel.`,
          ephemeral: true,
        })

        robot.logger.info("Creating custom webhook URL for team:", teamId)
        const customWebhookUrl = await createCustomWebhookUrl(channel, robot)

        if (customWebhookUrl) {
          const team = await linearClient.team(teamId)
          const sanitizedChannelName = sanitizeName(channel.name)
          const sanitizedTeamName = sanitizeName(team.name)
          const label = `discord-${sanitizedChannelName}-${sanitizedTeamName}`
          const secret = crypto.randomBytes(32).toString("hex")

          const createdWebhook = await linearClient.createWebhook({
            url: customWebhookUrl,
            teamId,
            resourceTypes: ["ProjectUpdate"],
            enabled: true,
            label,
            secret,
          })

          if (!existingConnections[teamId]) {
            existingConnections[teamId] = {}
          }

          existingConnections[teamId][channel.id] = {
            webhookUrl: customWebhookUrl,
            linearWebhookId: createdWebhook.webhook,
            secret,
            teamId,
            channelId: channel.id,
          }
          robot.brain.set(LINEAR_BRAIN_KEY, {
            connections: existingConnections,
          })

          await interaction.editReply({
            content: `Connected Linear team **${team.name}** to this channel.`,
          })
        } else {
          await interaction.editReply({
            content: `Failed to generate custom webhook URL for team ${teamId}.`,
          })
        }
      } else if (subcommand === DISCONNECT_SUBCOMMAND_NAME) {
        const { channel } = interaction
        if (!(channel instanceof TextChannel)) {
          await interaction.reply({
            content: "This command must be used in a text channel.",
            ephemeral: true,
          })
          return
        }

        const team = await linearClient.team(teamId)
        const sanitizedChannelName = sanitizeName(channel.name)
        const sanitizedTeamName = sanitizeName(team.name)
        const label = `discord-${sanitizedChannelName}-${sanitizedTeamName}`

        try {
          const webhooks = await linearClient.webhooks()
          const matchingWebhook = await Promise.all(
            webhooks.nodes.map(async (webhook) => {
              if (webhook.label !== label || !webhook.team) return null
              const linearTeam = await webhook.team
              return linearTeam.id === teamId ? webhook : null
            }),
          )

          const foundWebhook = matchingWebhook.find(
            (wh): wh is (typeof webhooks.nodes)[number] => !!wh,
          )

          if (foundWebhook) {
            await linearClient.deleteWebhook(foundWebhook.id)
            robot.logger.info(
              `Deleted webhook with label ${label} (id: ${foundWebhook.id})`,
            )
          } else {
            robot.logger.error(`No webhook found with label: ${label}`)
          }
        } catch (err) {
          robot.logger.error(`Error deleting webhook with label ${label}:`, err)
        }

        delete existingConnections[teamId]
        robot.brain.set(LINEAR_BRAIN_KEY, { connections: existingConnections })

        await interaction.reply({
          content: `Disconnected Linear team **${team.name}** updates from this channel.`,
          ephemeral: true,
        })
      }
    }
  })
  robot.router.post(
    /^\/linear\/webhook\/([a-z0-9-]+)-(\d{6})$/,
    async (request, response) => {
      try {
        const eventData = request.body
        const channelName = request.params[0]
        const channelId = eventData.data?.infoSnapshot?.teamsInfo?.[0]?.id
        if (!channelId) {
          robot.logger.error("Channel name not found in the payload.")
          response.writeHead(400).end("Channel not found in payload.")
          return
        }

        robot.logger.debug(
          "Webhook payload:",
          JSON.stringify(eventData, null, 2),
        )

        const existingConnections =
          robot.brain.get(LINEAR_BRAIN_KEY)?.connections ?? {}
        const connection = existingConnections[channelId]

        if (!connection) {
          robot.logger.error(
            `No stored connection found for channel: ${channelId}`,
          )
          response.writeHead(404).end("Channel not found.")
          return
        }

        const teamIdFromEvent =
          eventData?.data?.infoSnapshot?.teamsInfo?.[0]?.id
        if (connection.teamId !== teamIdFromEvent) {
          robot.logger.error("Team ID mismatch.")
          response.writeHead(403).end("Forbidden: Team ID mismatch.")
          return
        }

        robot.logger.debug("Request headers:", request.headers)
        const { secret } = connection
        const { "linear-signature": signature } = request.headers
        if (!signature) {
          robot.logger.error("Missing Linear signature in request headers.")
          response.writeHead(400).end("Missing signature.")
          return
        }

        const computedSignature = crypto
          .createHmac("sha256", secret)
          .update(JSON.stringify(eventData))
          .digest("hex")

        if (signature !== computedSignature) {
          robot.logger.error("Signature verification failed.")
          response.writeHead(403).end("Forbidden: Invalid signature.")
          return
        }

        robot.logger.info("Signature verified successfully.")

        const guilds = discordClient.guilds.cache
        const guildArray = Array.from(guilds.values())

        const findChannelPromises = guildArray.map(async (guild) => {
          const channels = await guild.channels.fetch()
          return channels.find(
            (ch) =>
              ch?.isTextBased?.() &&
              ch.name.toLowerCase().replace(/\s+/g, "-") === channelName,
          )
        })

        const potentialChannels = await Promise.all(findChannelPromises)
        const matchedChannel =
          potentialChannels.find((ch) => ch?.isTextBased?.()) || null

        if (!matchedChannel) {
          robot.logger.error(
            `No matching channel found for name: ${channelName}`,
          )
          response.writeHead(404).end("Channel not found.")
          return
        }

        const eventType = eventData?.type
        if (!eventType || !eventHandlers[eventType]) {
          robot.logger.error(`Unhandled or missing event type: ${eventType}`)
          response.writeHead(200).end("Event ignored.")
          return
        }

        await eventHandlers[eventType](
          eventData,
          matchedChannel as TextBasedChannel,
          robot,
        )
        response.writeHead(200).end("Event processed.")
      } catch (err) {
        robot.logger.error("Error handling Linear webhook:", err)
        response.writeHead(500).end("Error")
      }
    },
  )
}
