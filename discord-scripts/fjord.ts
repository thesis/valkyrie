import { ChannelType, Client, Message } from "discord.js"
import axios from "axios"
import { Robot } from "hubot"

// This is the WIP discord implementation of commands to trigger certain workflows on the thesis n8n platform. Most of the integration uses webhooks and chat commands with response headers .
// eslint-disable-next-line
export default function manageFjord(discordClient: Client, robot: Robot) {
  if (process.env.HUBOT_N8N_ENABLE === "true") {
    // Events to fire after certain button interactions
    discordClient.on("interactionCreate", async (interaction) => {
      if (interaction.isButton()) {
        const buttonID = interaction.customId
        if (
          buttonID.startsWith("stale-issues") ||
          buttonID.startsWith("issues") ||
          buttonID.startsWith("activity") ||
          buttonID.startsWith("debug") ||
          buttonID.startsWith("ping") ||
          buttonID.startsWith("exec")
        ) {
          interaction.reply({
            content: `!${buttonID}`,
          })
        }
      }
    })

    discordClient.on("messageCreate", async (message) => {
      const { channel } = message

      const handleThreadCreate = async (
        message: Message, // eslint-disable-line
        threadName: string,
        threadReason: string,
        responseData: string,
      ) => {
        const debugThread = await message.startThread({
          name: threadName,
          autoArchiveDuration: 60,
          reason: threadReason,
        })
        await debugThread.send("Over here!")
        await debugThread.send(responseData)
      }

      if (message.content === "!ping") {
        channel.send({
          content: "ping pong ping ping pong ping / o  o",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  label: "Ping?",
                  style: 1,
                  custom_id: "ping",
                },
              ],
            },
          ],
        })
      }

      if (message.content === "!debug") {
        console.log("adapter in use:", robot.adapter)
        channel.send({
          content: "**Debugger running, check your console ;)**",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  label: "Run debugger again",
                  style: 1,
                  custom_id: "debug",
                },
              ],
            },
          ],
        })
      }

      if (message.content === "!fjord") {
        channel.send("**Fjord is listening, what do you want?**")
        channel.send(
          "Here's a list of Fjord commands. !issues <repo-owner> <repo-name> !stale-issues <repo-owner> <repo-name> !debug !activity <repo-owner> <repo-name>",
        )
      }

      if (message.content === "!thread") {
        if (message.channel.type === ChannelType.GuildPublicThread) {
          channel.send("You can't thread a thread!")
        }
        const threadName = "New thread"
        await handleThreadCreate(
          message,
          threadName,
          "thread test",
          "Setup a thread for you",
        )
      }

      if (message.content.startsWith("!stale-issues")) {
        const parameters = message.content.split(" ").slice(1)
        if (parameters.length >= 2) {
          const [repositoryOwner, repositoryName] = parameters
          const webhookUrl = process.env.HUBOT_N8N_WEBHOOK
          const queryParams = new URLSearchParams({
            repositoryOwner,
            repositoryName,
          })

          await message.reply({
            content: `**Stale issue automation:  ${repositoryOwner} / ${repositoryName}**`,
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    label: "Run again",
                    style: 1,
                    custom_id: `stale-issues ${repositoryOwner} ${repositoryName}`,
                  },
                ],
              },
            ],
          })
          const options = {
            headers: {
              workflowType: "stale-issues",
            },
          }
          axios
            .get(`${webhookUrl}?${queryParams.toString()}`, options)
            .then(async (response) => {
              if (message.channel.type === ChannelType.GuildPublicThread) {
                channel.send(response.data)
              } else {
                const threadName = `${repositoryOwner}/${repositoryName} - Stale issues`
                await handleThreadCreate(
                  message,
                  threadName,
                  "stale issues",
                  response.data,
                )
              }
            })
            .catch((error) => {
              channel.send(
                `Automation stale-issues flow failed: ${error.message}`,
              )
            })
        } else {
          channel.send(
            "**Please provide these parameters: !stale-issues <username> <repo> **",
          )
        }
      }

      if (message.content.startsWith("!issues")) {
        const parameters = message.content.split(" ").slice(1)
        if (parameters.length >= 2) {
          const [repositoryOwner, repositoryName] = parameters
          const webhookUrl = process.env.HUBOT_N8N_WEBHOOK
          const queryParams = new URLSearchParams({
            repositoryOwner,
            repositoryName,
          })

          await message.reply({
            content: `**Get issues automation:  ${repositoryOwner} / ${repositoryName}**`,
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    label: "Run again",
                    style: 1,
                    custom_id: `issues ${repositoryOwner} ${repositoryName}`,
                  },
                ],
              },
            ],
          })
          const options = {
            headers: {
              workflowType: "issues",
            },
          }
          axios
            .get(`${webhookUrl}?${queryParams.toString()}`, options)
            .then(async (response) => {
              if (message.channel.type === ChannelType.GuildPublicThread) {
                channel.send(response.data)
              } else {
                const threadName = `${repositoryOwner}/${repositoryName} - recent issues`
                await handleThreadCreate(
                  message,
                  threadName,
                  "recent issues",
                  response.data,
                )
              }
            })
            .catch((error) => {
              channel.send(
                `Automation recent issues flow failed: ${error.message}`,
              )
            })
        } else {
          channel.send(
            "**Please provide these parameters: !issues <username> <repo> **",
          )
        }
      }

      if (message.content.startsWith("!activity")) {
        const parameters = message.content.split(" ").slice(1)
        if (parameters.length >= 2) {
          const [repositoryOwner, repositoryName] = parameters
          const webhookUrl = process.env.HUBOT_N8N_WEBHOOK
          const queryParams = new URLSearchParams({
            repositoryOwner,
            repositoryName,
          })

          await message.reply({
            content: `**Git activity automation:  ${repositoryOwner} / ${repositoryName}**`,
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    label: "Run again",
                    style: 1,
                    custom_id: `activity ${repositoryOwner} ${repositoryName}`,
                  },
                ],
              },
            ],
          })
          const options = {
            headers: {
              workflowType: "activity",
            },
          }
          axios
            .get(`${webhookUrl}?${queryParams.toString()}`, options)
            .then(async (response) => {
              if (message.channel.type === ChannelType.GuildPublicThread) {
                channel.send(response.data)
              } else {
                const threadName = `${repositoryOwner}/${repositoryName} - git activity`
                await handleThreadCreate(
                  message,
                  threadName,
                  "git activity",
                  response.data,
                )
              }
            })
            .catch((error) => {
              channel.send(
                `Automation git activity flow failed: ${error.message}`,
              )
            })
        } else {
          channel.send(
            "**Please provide these parameters: !activity <username> <repo> **",
          )
        }
      }

      if (message.content.startsWith("!exec")) {
        const parameters = message.content.split(" ").slice(1)
        if (parameters.length >= 1) {
          const [workflowName] = parameters
          const webhookUrl = process.env.HUBOT_N8N_WEBHOOK
          const queryParams = new URLSearchParams({
            workflowName,
          })

          await message.reply({
            content: `**n8n worklow:  ${workflowName}**`,
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    label: "Run again",
                    style: 1,
                    custom_id: `exec ${workflowName}`,
                  },
                ],
              },
            ],
          })
          const options = {
            headers: {
              workflowType: "exec",
            },
          }
          axios
            .get(`${webhookUrl}?${queryParams.toString()}`, options)
            .then(async (response) => {
              channel.send(response.data)
            })
            .catch((error) => {
              channel.send(`Automation workflow failed: ${error.message}`)
            })
        } else {
          channel.send(
            "**Please provide these parameters: !exec <workflow-name>**",
          )
        }
      }
    })
  }
}
