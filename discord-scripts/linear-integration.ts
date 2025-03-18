import {
  ApplicationCommandOptionType,
  Client,
  EmbedBuilder,
  TextBasedChannel,
  TextChannel,
  Webhook,
} from "discord.js"
import { LinearClient } from "@linear/sdk"
import { Robot } from "hubot"
const COMMAND_NAME = "linear-update"
const CONNECT_SUBCOMMAND_NAME = "connect"
const DISCONNECT_SUBCOMMAND_NAME = "disconnect"
const { LINEAR_API_TOKEN } = process.env
const LINEAR_BRAIN_KEY = "linear"

const linearClient = new LinearClient({ apiKey: LINEAR_API_TOKEN })

const eventHandlers: Record<
  string,
  (data: any, channel: TextBasedChannel, robot: Robot) => Promise<void>
> = {
  ProjectUpdated: async ({ project, user }, channel) => {
    const embed = new EmbedBuilder()
      .setTitle(`Project Updated: ${project.name}`)
      .setDescription(project.description || "No description provided.")
      .setURL(`https://linear.app/project/${project.id}`)
      .setAuthor({ name: user.name, iconURL: user.avatarUrl })
      .setTimestamp()
    channel.send({ embeds: [embed] })
  },
  IssueCreated: async ({ issue, user }, channel) => {
    const embed = new EmbedBuilder()
      .setTitle(`New Issue Created: ${issue.title}`)
      .setDescription(issue.description || "No description provided.")
      .setURL(`https://linear.app/issue/${issue.id}`)
      .setAuthor({ name: user.name, iconURL: user.avatarUrl })
      .setTimestamp()
    channel.send({ embeds: [embed] })
  },
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

async function createDiscordWebhook(
  channel: TextBasedChannel,
): Promise<string | null> {
  try {
    if (!(channel instanceof TextChannel)) {
      console.error("Webhook creation failed: Channel is not a TextChannel.")
      return null
    }

    const webhook: Webhook = await channel.createWebhook({
      name: "Linear Updates",
    })

    console.log("Created Discord webhook:", webhook.url)
    return webhook.url
  } catch (error) {
    console.error("Error creating Discord webhook:", error)
    return null
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
        const channel = interaction.channel
        if (!channel || !channel.isTextBased()) {
          await interaction.reply({
            content: "Invalid channel.",
            ephemeral: true,
          })
          return
        }

        await interaction.reply({ ephemeral: true })

        robot.logger.info("Creating Discord webhook for team:", teamId)
        const webhookUrl = await createDiscordWebhook(channel)

        if (webhookUrl) {
          existingConnections[teamId] = { webhookUrl }
          robot.brain.set(LINEAR_BRAIN_KEY, {
            connections: existingConnections,
          })

          await interaction.editReply({
            content: `Connected Linear team **${teamId}** to this channel with a Discord webhook.`,
          })
        } else {
          await interaction.editReply({
            content: `Failed to create Discord webhook for team ${teamId}.`,
          })
        }
      } else if (subcommand === DISCONNECT_SUBCOMMAND_NAME) {
        delete existingConnections[teamId]
        robot.brain.set(LINEAR_BRAIN_KEY, { connections: existingConnections })
        await interaction.reply({
          content: `Disconnected Linear team **${teamId}**.`,
        })
      }
    }
  })
}
