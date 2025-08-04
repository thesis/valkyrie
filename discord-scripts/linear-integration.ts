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

type LinearWebhookEvent = {
  data: {
    id: string
    createdAt: string
    updatedAt: string
    body: string
    project: {
      id: string
      name: string
      url: string
    }
  }
  actor: {
    id: string
    name: string
    email: string
    avatarUrl: string
  }
  url: string
  type: string
}

type LinearConnection = {
  webhookUrl: string
  linearWebhookId: string
  secret: string
  teamId: string
  channelId: string
}

type LinearConnections = {
  [teamId: string]: {
    [channelId: string]: LinearConnection
  }
}

const eventHandlers: Record<
  string,
  (data: LinearWebhookEvent, channel: TextBasedChannel, robot: Robot) => Promise<void>
> = {
  ProjectUpdate: async ({ data, actor, url }, channel) => {
    const embed = new EmbedBuilder()
      .setTitle(`Project Update: ${data.project.name}`)
      .setDescription(data.body || "No description provided.")
      .setURL(url)
      .setAuthor({ name: actor.name, iconURL: actor.avatarUrl })
      .setTimestamp()

    if (!channel.isSendable()) {
      throw new Error("Channel is not sendable")
    }
    await channel.send({ embeds: [embed] })
  },
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-")
}

async function createCustomWebhookUrl(
  channel: TextBasedChannel,
  robot: Robot,
): Promise<string | null> {
  try {
    if (!(channel instanceof TextChannel)) {
      robot.logger.error(
        "Webhook creation failed: Channel is not a TextChannel.",
      )
      return null
    }

    const randomId = Math.floor(100000 + Math.random() * 900000)
    const channelId = channel.id
    const customWebhookUrl = `${VALKYRIE_WEBHOOK_URL}linear/webhook/${channelId}-${randomId}`

    robot.logger.info("Generated custom webhook URL:", customWebhookUrl)
    return customWebhookUrl
  } catch (error) {
    robot.logger.error("Error generating custom webhook URL:", error)
    return null
  }
}

async function fetchLinearTeams(robot: Robot) {
  try {
    const teams = await linearClient.teams()
    return teams.nodes.map((team) => ({ id: team.id, name: team.name }))
  } catch (error) {
    robot.logger.error("Error fetching Linear teams:", error)
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
              autocomplete: true,
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
              autocomplete: true,
            },
          ],
        },
      ],
    })
    robot.logger.info("Created linear command.")
    robot.logger.info("✅ Linear Updates script loaded.")
  }

  discordClient.on("interactionCreate", async (interaction) => {
    robot.logger.debug("Received interaction:", interaction)
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

      const existingConnections: LinearConnections =
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
          content: "Connecting project updates to this channel.",
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

          const webhook = await createdWebhook.webhook
          if (!webhook) {
            throw new Error("Failed to create webhook")
          }

          existingConnections[teamId][channel.id] = {
            webhookUrl: customWebhookUrl,
            linearWebhookId: webhook.id,
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

        const connection = existingConnections[teamId]?.[channel.id]
        if (!connection) {
          await interaction.reply({
            content: "This team is not connected to this channel",
            ephemeral: true,
          })
          return
        }
        
        if (connection.linearWebhookId) {
          try {
            await linearClient.deleteWebhook(connection.linearWebhookId)
            robot.logger.info(
              `Deleted webhook with ID: ${connection.linearWebhookId}`,
            )
          } catch (err) {
            robot.logger.error(
              `Error deleting webhook with ID ${connection.linearWebhookId}:`,
              err,
            )
          }
        } else {
          robot.logger.error("No webhook ID found in connection")
        }

        const team = await linearClient.team(teamId)
        
        delete existingConnections[teamId][channel.id]
        if (Object.keys(existingConnections[teamId]).length === 0) {
          delete existingConnections[teamId]
        }
        robot.brain.set(LINEAR_BRAIN_KEY, { connections: existingConnections })

        await interaction.reply({
          content: `Disconnected Linear team **${team.name}** updates from this channel.`,
          ephemeral: true,
        })
      }
    }
  })

  discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isAutocomplete()) return
    if (interaction.commandName !== COMMAND_NAME) return

    const focusedOption = interaction.options.getFocused(true)
    if (focusedOption.name !== "team") return

    const subcommand = interaction.options.getSubcommand()
    
    if (subcommand === CONNECT_SUBCOMMAND_NAME) {
      // For connect, show all available teams
      const teams = await fetchLinearTeams(robot)
      const filtered = teams.filter((team) =>
        team.name.toLowerCase().includes(focusedOption.value.toLowerCase()),
      )

      await interaction.respond(
        filtered.slice(0, 25).map((team) => ({
          name: team.name,
          value: team.id,
        })),
      )
    } else if (subcommand === DISCONNECT_SUBCOMMAND_NAME) {
      // For disconnect, show only connected teams in this channel
      const existingConnections: LinearConnections =
        robot.brain.get(LINEAR_BRAIN_KEY)?.connections ?? {}
      
      const channelId = interaction.channelId
      const connectedTeams: Array<{ id: string; name: string }> = []
      
      for (const [teamId, teamConnections] of Object.entries(existingConnections)) {
        if (teamConnections[channelId]) {
          try {
            const team = await linearClient.team(teamId)
            connectedTeams.push({ id: team.id, name: team.name })
          } catch (error) {
            robot.logger.error(`Error fetching team ${teamId}:`, error)
          }
        }
      }
      
      const filtered = connectedTeams.filter((team) =>
        team.name.toLowerCase().includes(focusedOption.value.toLowerCase()),
      )

      await interaction.respond(
        filtered.slice(0, 25).map((team) => ({
          name: team.name,
          value: team.id,
        })),
      )
    }
  })

  robot.router.post(
    /^\/linear\/webhook\/(\d+)-(\d{6})$/,
    async (request, response) => {
      try {
        const eventData = request.body
        const channelId = request.params[0]
        const webhookId = eventData?.webhookId

        robot.logger.debug(
          "Webhook payload:",
          JSON.stringify(eventData, null, 2),
        )

        const channel = await discordClient.channels
          .fetch(channelId)
          .catch(() => null)
        if (!channel || !channel.isTextBased()) {
          robot.logger.error(`Channel ${channelId} not found or not text-based`)
          response.writeHead(404).end("Channel not found.")
          return
        }

        // Find connection by webhook ID instead of team ID
        const existingConnections: LinearConnections =
          robot.brain.get(LINEAR_BRAIN_KEY)?.connections ?? {}
        
        let connection = null
        let _connectionTeamId = null
        
        // Search through all connections to find matching webhook ID and channel
        for (const [teamId, teamConnections] of Object.entries(existingConnections)) {
          const teamConnection = teamConnections[channelId]
          if (teamConnection && teamConnection.linearWebhookId === webhookId) {
            connection = teamConnection
            _connectionTeamId = teamId
            break
          }
        }

        if (!connection) {
          robot.logger.error(
            `No stored connection for webhook ${webhookId} in channel ${channelId}`,
          )
          response.writeHead(404).end("Connection not found.")
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

        const eventType = eventData?.type
        if (!eventType || !eventHandlers[eventType]) {
          robot.logger.error(`Unhandled or missing event type: ${eventType}`)
          response.writeHead(200).end("Event ignored.")
          return
        }

        await eventHandlers[eventType](
          eventData,
          channel as TextBasedChannel,
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
