import {
  ApplicationCommandOptionType,
  ChannelType,
  Client,
  EmbedBuilder,
  GuildTextBasedChannel,
  TextBasedChannel,
} from "discord.js"

import { randomBytes } from "crypto"

import * as Figma from "figma-api"
import { DiscordBot } from "hubot-discord"
import { User } from "figma-api/lib/api-types"
import { HOST, MINUTE } from "../lib/globals.ts"

type DiscordHubot = Hubot.Robot<DiscordBot>

const COMMAND_NAME = "figma"
const CONNECT_SUBCOMMAND_NAME = "connect"
const DISCONNECT_SUBCOMMAND_NAME = "disconnect"
// FIXME Replace with a proper per-user OAuth interaction like GitHub, using
// FIXME passport-figma.
const { FIGMA_API_TOKEN } = process.env

const FIGMA_BRAIN_KEY = "figma"

// Only post about an unnamed file update after 10 minutes without changes.
const FILE_UPDATE_POST_TIMEOUT = 10 * MINUTE

const teamIdsByName: { [name: string]: string } = {
  embody: "1166424569169614354",
  "threshold network": "1004032249327182211",
  keep: "953697796065703632",
  taho: "953697445071473329",
  thesis: "597157463033100784",
}

const eventHandlers: {
  [eventType: string]: (
    // Unfortunately this is coming in via API.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any,
    channel: TextBasedChannel,
    figma: Figma.Api,
    robot: DiscordHubot,
  ) => Promise<void>
} = {
  FILE_COMMENT: async (
    {
      file_key: fileKey,
      file_name: fileName,
      comment_id: commentId,
    }: {
      comment_id: string
      file_name: string
      file_key: string
      event_type: "FILE_COMMENT"
    },
    channel,
    figma,
    robot,
  ) => {
    const postedComment = (await figma.getComments(fileKey)).comments.find(
      ({ id }) => id === commentId,
    )

    if (postedComment === undefined) {
      robot.logger.error(
        `Notified of Figma comment with id ${commentId} in file ${fileKey} but could not resolve it.`,
      )
      return
    }

    const commentEmbed = new EmbedBuilder()
    commentEmbed
      .setURL(`https://www.figma.com/file/${fileKey}`)
      .setAuthor({
        name: postedComment.user.handle,
        iconURL: postedComment.user.img_url,
      })
      .setTitle(`Comment on ${fileName}`)
      .setDescription(postedComment.message)

    // When the comment is on a node, render the node and include in the embed.
    // Otherwise, use the file thumbnail.
    const clientMeta = postedComment.client_meta
    if (clientMeta !== null && "node_id" in clientMeta) {
      const {
        images: { [clientMeta.node_id]: renderedNode },
      } = await figma.getImage(fileKey, {
        ids: clientMeta.node_id,
        format: "png",
        scale: 1,
      })

      if (renderedNode !== undefined && renderedNode !== null) {
        commentEmbed.setImage(renderedNode)
      }
    } else {
      // TODO When the comment clientMeta has a point position, fetch all nodes
      // TODO on the containing file and render all nodes that overlap the
      // TODO coordinates.

      const file = await figma.getFile(fileKey)
      commentEmbed.setThumbnail(file.thumbnailUrl)
    }

    channel.send({ embeds: [commentEmbed] })
  },
  FILE_UPDATE: async (
    {
      file_key: fileKey,
      file_name: fileName,
    }: {
      file_key: string
      file_name: string
      event_type: "FILE_UPDATE"
    },
    channel,
    _,
    robot,
  ) => {
    // Marks latest updates for this file/channel combo. These are checked
    // periodically, and files with no changes in FILE_UPDATE_POST_TIMEOUT post
    // an update notification in the channel.
    const lastMarkedKey = `${fileKey}-${channel.id}`
    const lastMarkedUpdatesByFileKey: {
      [lastMarkedKey: string]: {
        lastUpdate: number
        fileKey: string
        fileName: string
        channelId: string
      }
    } = robot.brain.get(FIGMA_BRAIN_KEY).lastMarkedUpdatesByFileKey ?? {}

    // Mark the last notified update.
    robot.brain.set(FIGMA_BRAIN_KEY, {
      ...robot.brain.get(FIGMA_BRAIN_KEY),
      lastMarkedUpdatesByFileKey: {
        ...lastMarkedUpdatesByFileKey,
        [lastMarkedKey]: {
          lastUpdate: Date.now(),
          fileKey,
          fileName,
          channelId: channel.id,
        },
      },
    })
  },
  FILE_VERSION_UPDATE: async (
    {
      file_key: fileKey,
      file_name: fileName,
      label,
      description,
      triggered_by: triggeredBy,
      version_id: versionId,
    }: {
      file_key: string
      file_name: string
      label: string
      description: string
      triggered_by: User
      version_id: string
      event_type: "FILE_VERSION_UPDATE"
    },
    channel,
    figma,
  ) => {
    const commentEmbed = new EmbedBuilder()
    commentEmbed
      .setURL(`https://www.figma.com/file/${fileKey}?version-id=${versionId}`)
      .setAuthor({
        name: triggeredBy.handle,
        iconURL: triggeredBy.img_url,
      })
      .setTitle(`Tagged version for ${fileName}: ${label}`)
      .setDescription(description)
      .setFields({
        name: "Latest (untagged) version",
        value: `https://www.figma.com/file/${fileKey}`,
        inline: true,
      })

    const file = await figma.getFile(fileKey)
    commentEmbed.setThumbnail(file.thumbnailUrl)

    channel.send({ embeds: [commentEmbed] })
  },
}

function resolveTeamFromChannel(channel: GuildTextBasedChannel) {
  // If we have `something-figma`, use `something` as the team name.
  if (channel.name.endsWith("-figma")) {
    return channel.name.replace(/-figma$/, "").replace(/-/g, " ")
  }

  // If we don't have `something-figma`, and it's not multi-word, return the
  // channel name.
  if (!channel.name.includes("-")) {
    return channel.name
  }

  // If the channel name is multi-word and the channel is in a category, use
  // the category instead.
  if (channel.parent?.type === ChannelType.GuildCategory) {
    return channel.parent?.name
  }

  // If the channel isn't in a category, use the channel name directly.
  return channel.name.replace(/-/g, " ")
}

export default async function figmaIntegration(
  discordClient: Client,
  robot: DiscordHubot,
) {
  robot.logger.info("Configuring Figma integration.")

  const { application } = discordClient
  if (application === null) {
    robot.logger.error(
      "Failed to resolve Discord application, dropping Figma handling.",
    )
    return
  }

  const existingFigmaCommand = (await application.commands.fetch()).find(
    (command) => command.name === "figma",
  )

  // Make sure the command exists if we have an API token, or make sure it
  // doesn't if we have no API token.
  if (existingFigmaCommand === undefined && FIGMA_API_TOKEN !== undefined) {
    robot.logger.info("No figma command yet, creating it!")
    await application.commands.create({
      name: COMMAND_NAME,
      description:
        "Integrates notifications from a Figma project into this channel.",
      options: [
        {
          name: CONNECT_SUBCOMMAND_NAME,
          type: ApplicationCommandOptionType.Subcommand,
          description:
            "Connects notifications from a Figma team to this channel.",
          options: [
            {
              name: "team",
              type: ApplicationCommandOptionType.String,
              description:
                "The id or name of the team to connect; inferred from channel name/category if left off.",
              required: false,
            },
          ],
        },
        {
          name: DISCONNECT_SUBCOMMAND_NAME,
          type: ApplicationCommandOptionType.Subcommand,
          description:
            "Disconnects notifications from a Figma team from this channel.",
          options: [
            {
              name: "team",
              type: ApplicationCommandOptionType.String,
              description:
                "The id or name of the team to post notifications from.",
              required: true,
            },
          ],
        },
      ],
    })

    robot.logger.info("Created figma command.")
  }

  if (existingFigmaCommand !== undefined && FIGMA_API_TOKEN === undefined) {
    robot.logger.info(
      "Failed to resolve an API token for Figma, deleting Figma command and dropping Figma handling.",
    )
    await existingFigmaCommand.delete()
    return
  }

  if (FIGMA_API_TOKEN === undefined) {
    robot.logger.error(
      "Failed to resolve an API token for Figma, dropping Figma handling.",
    )
    return
  }

  robot.logger.info(
    "Figma command configured, setting up remaining integration.",
  )

  const figma = new Figma.Api({
    personalAccessToken: FIGMA_API_TOKEN,
  })

  // Periodically check the list of marked updates for files; once a file was
  // last updated more than FILE_UPDATE_POST_TIMEOUT ago, post the update to
  // the connected channel.
  setInterval(async () => {
    const lastMarkedUpdatesByFileKey: {
      [lastMarkedKey: string]: {
        lastUpdate: number
        fileKey: string
        fileName: string
        channelId: string
      }
    } = robot.brain.get(FIGMA_BRAIN_KEY)?.lastMarkedUpdatesByFileKey ?? {}

    const pendingUpdateEntries = Object.entries(
      lastMarkedUpdatesByFileKey,
    ).filter(([, { fileKey, fileName, lastUpdate, channelId }]) => {
      const shouldPostUpdate =
        Date.now() - lastUpdate >= FILE_UPDATE_POST_TIMEOUT

      if (!shouldPostUpdate) {
        // Don't post an update, and include for future pending update checks.
        return true
      }

      const channel = discordClient.channels.cache.get(channelId)
      if (channel === undefined || !channel.isTextBased()) {
        // Don't post an update and don't try again later, since the channel id
        // resolution failed.
        robot.logger.error(
          `Got an invalid channel id ${channelId} while trying to post Figma file update for ${fileKey}; evicting.`,
        )
        return false
      }

      // Use an async IIFE to wrap our awaits for Figma updates. If the update
      // fails, log it and move on.
      const postUpdate = async () => {
        try {
          const { versions } = await figma.getVersions(fileKey)
          const latestVersion = versions.at(0)
          if (latestVersion !== undefined && latestVersion?.label !== null) {
            // If the latest version is a named version, rely on FILE_VERSION_UPDATE
            // event and skip notifying.
            return
          }

          const commentEmbed = new EmbedBuilder()
          commentEmbed
            .setURL(`https://www.figma.com/file/${fileKey}`)
            .setTitle(`${fileName} Updated`)

          if (latestVersion !== undefined) {
            commentEmbed.setAuthor({
              name: latestVersion.user.handle,
              iconURL: latestVersion.user.img_url,
            })
          }

          const file = await figma.getFile(fileKey)
          commentEmbed.setThumbnail(file.thumbnailUrl)

          channel.send({ embeds: [commentEmbed] })
        } catch (error) {
          robot.logger.error(
            `Failed to post Figma file update for ${fileKey} into channel ${channel}: ${error}`,
          )
        }
      }
      postUpdate()

      // Update posted, don't include in pending updates.
      return false
    })

    // Put remaining update entries back into the brain.
    robot.brain.set(FIGMA_BRAIN_KEY, {
      ...robot.brain.get(FIGMA_BRAIN_KEY),
      lastMarkedUpdatesByFileKey: Object.fromEntries(pendingUpdateEntries),
    })
  }, 1 * MINUTE)

  discordClient.on("interactionCreate", async (interaction) => {
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === COMMAND_NAME &&
      interaction.channel !== null &&
      !interaction.channel.isDMBased()
    ) {
      const connectOrDisconnect = interaction.options.getSubcommand()
      const specifiedTeam = interaction.options.getString("team")

      const team =
        specifiedTeam === null
          ? resolveTeamFromChannel(interaction.channel).toLowerCase()
          : specifiedTeam.toLowerCase()

      const teamId = teamIdsByName[team]

      if (teamId === undefined) {
        interaction.reply({
          content: `Couldn't find a team id for the Figma team ${team}; could not take action.`,
          ephemeral: true,
        })
        return
      }

      const existingFigmaData = robot.brain.get(FIGMA_BRAIN_KEY) ?? {}
      const existingConnections = existingFigmaData.connections ?? {}

      if (connectOrDisconnect === DISCONNECT_SUBCOMMAND_NAME) {
        const existingPasscode = existingConnections[teamId]?.passcode
        const result = (await figma.request(
          `https://api.figma.com/v2/teams/${teamId}/webhooks`,
        )) as { webhooks: { passcode: string; id: string }[] }

        const { webhooks } = result

        webhooks
          .filter(({ passcode }) => passcode === existingPasscode)
          .forEach(async ({ id: webhookId }) => {
            await figma.request(`/v2/webhooks/${webhookId}`, {
              method: "delete",
              data: "",
            })
          })

        robot.brain.set(FIGMA_BRAIN_KEY, {
          ...existingFigmaData,
          connections: {
            ...existingConnections,
            [teamId]: undefined,
          },
        })

        interaction.reply({
          content: `Figma team ${team} disconnected from this channel.`,
        })

        return
      }

      if (
        teamId in (existingFigmaData.connections ?? {}) &&
        existingFigmaData.connections[teamId] !== undefined
      ) {
        interaction.reply({
          content: `Figma team ${team} already connected; to reset, try disconnecting first.`,
          ephemeral: true,
        })
        return
      }

      const passcode = randomBytes(48).toString("hex")
      const { id: channelId, name: channelName } = interaction.channel

      const subscriptions = await Promise.allSettled(
        ["FILE_COMMENT", "FILE_VERSION_UPDATE", "FILE_UPDATE"].map(
          async (event) => {
            await figma.request("https://api.figma.com/v2/webhooks", {
              method: "post",
              // @ts-expect-error Fake it.
              data: {
                event_type: event,
                team_id: teamId,
                endpoint: `${HOST}/figma`,
                passcode,
                description: `Discord Figma integration for #${channelName}.`,
              },
            })
          },
        ),
      )

      robot.brain.set(FIGMA_BRAIN_KEY, {
        ...existingFigmaData,
        connections: {
          ...existingConnections,
          [teamId]: {
            passcode,
            channelId,
          },
        },
      })

      if (subscriptions.some(({ status }) => status === "rejected")) {
        interaction.reply({
          content: `Figma team ${team} not fully connected; to reset, try disconnecting first.`,
          embeds: subscriptions
            .filter((result) => result.status === "rejected")
            .map((rejected) => {
              const reason =
                rejected.status === "rejected" ? rejected.reason : {}
              delete reason.stack
              robot.logger.error("Error adding Figma webhook", reason.response)

              return new EmbedBuilder().setTitle(
                `API failure: ${
                  rejected.status === "rejected" && rejected.status
                }`,
              )
            }),
          ephemeral: true,
        })
        return
      }

      interaction.reply({
        content: `Figma team ${team} connected to this channel.`,
      })
    }
  })

  robot.router.get("/figma", async (request, response) => {
    try {
      const { teamId } = request.query

      const existingFigmaData = robot.brain.get(FIGMA_BRAIN_KEY) ?? {}
      const existingConnections = existingFigmaData.connections ?? {}

      const existingPasscode = existingConnections[teamId as string]?.passcode

      const result = (await figma.request(
        `https://api.figma.com/v2/teams/${teamId}/webhooks`,
      )) as { webhooks: { passcode: string; id: string }[] }

      const { webhooks } = result

      const contents = await Promise.all(
        webhooks
          .filter(({ passcode }) => passcode === existingPasscode)
          .map(async ({ id: webhookId }) =>
            JSON.stringify(
              await figma.request(
                `https://api.figma.com/v2/webhooks/${webhookId}/requests`,
                {
                  method: "get",
                  data: "",
                },
              ),
              undefined,
              2,
            ),
          ),
      )

      robot.logger.info(
        `Hook calls for webhooks ${webhooks.map(({ id }) => id)}: `,
        contents.join("\n\n"),
      )

      response.sendStatus(200)
    } catch (error) {
      response.send(`Things went boom unf. ${error}`).sendStatus(400)
    }
  })

  robot.router.post("/figma", async (request, response) => {
    if (typeof request.body !== "object") {
      response.sendStatus(400).send("Bad request, non-object body.")
      return
    }

    if (!("passcode" in request.body) || !("event_type" in request.body)) {
      response
        .sendStatus(400)
        .send("Bad request, no passcode or event_type passed.")
      return
    }

    const { event_type: eventType, passcode } = request.body
    const { channelId } = Object.values<{
      passcode: string
      channelId: string
    }>(robot.brain.get(FIGMA_BRAIN_KEY).connections ?? {}).find(
      (entry) => entry !== undefined && entry.passcode === passcode,
    ) ?? {
      channelId: undefined,
    }

    if (channelId === undefined) {
      robot.logger.error(
        `Failed to resolve channel ID for passcode ${passcode}.`,
      )

      response
        .sendStatus(400)
        .send("Bad request, unknown connection for passcode.")
      return
    }

    const discordChannel = await discordClient.channels.fetch(channelId)
    if (discordChannel === null || !discordChannel.isTextBased()) {
      robot.logger.error(
        `When handling event ${eventType} for connection to channel with id ${channelId}, failed to resolve channel to a text channel.`,
      )
      return
    }

    eventHandlers[eventType]?.(request.body, discordChannel, figma, robot)

    // 200 response ensures Figma won't try to redeliver events.
    response.sendStatus(200)
  })

  robot.logger.info("Figma integration configured.")
}
