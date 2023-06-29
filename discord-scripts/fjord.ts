import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  Client,
  CommandInteraction,
  Guild,
  GuildMember,
  ModalBuilder,
  ModalActionRowComponentBuilder,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js"
import axios from "axios"
import { Robot } from "hubot"

// This is the WIP discord implementation of commands to trigger certain workflows on the thesis n8n platform. Most of the integration uses webhooks and chat commands with response headers .
export default async function manageFjord(discordClient: Client, robot: Robot) {
  const { application } = discordClient
  const webhookUrl = process.env.HUBOT_N8N_WEBHOOK

  if (application) {
    const existingFjordCommand = (await application.commands.fetch()).find(
      (command) => command.name === "issues",
    )
    if (existingFjordCommand === undefined) {
      application.commands.set([
        {
          name: "debug",
          description:
            "Runs the debug command, sending logs to Valkyrie console",
        },
        {
          name: "stale-issues",
          description: "Retrieve stale issues from specific git repository",
          options: [
            {
              name: "repository-owner",
              type: ApplicationCommandOptionType.String,
              description: "The owner of the repository",
              required: true,
            },
            {
              name: "repository-name",
              type: ApplicationCommandOptionType.String,
              description: "The name of the repository",
              required: true,
            },
          ],
        },
        {
          name: "issues",
          description: "Retrieve recent issues from specific git repository",
          options: [
            {
              name: "repository-owner",
              type: ApplicationCommandOptionType.String,
              description: "The owner of the repository",
              required: true,
            },
            {
              name: "repository-name",
              type: ApplicationCommandOptionType.String,
              description: "The name of the repository",
              required: true,
            },
          ],
        },
        {
          name: "activity",
          description: "Retrieve activity summary from specific git repository",
          options: [
            {
              name: "repository-owner",
              type: ApplicationCommandOptionType.String,
              description: "The owner of the repository",
              required: true,
            },
            {
              name: "repository-name",
              type: ApplicationCommandOptionType.String,
              description: "The name of the repository",
              required: true,
            },
          ],
        },
        {
          name: "n8n",
          description: "Run specific workflow from n8n",
          options: [
            {
              name: "workflow-name",
              type: ApplicationCommandOptionType.String,
              description: "The name of the workflow to run",
              required: true,
            },
          ],
        },
      ])
    }
  }
  const startLoadingBar = async (
    interaction: CommandInteraction,
    repositoryOwner: string,
    repositoryName: string,
  ) => {
    const loadingMessage = await interaction.reply({
      content: `**Workflow started: ${repositoryOwner} / ${repositoryName}**\n\n:hourglass: In progress...`,
      ephemeral: true,
    })

    const loadingBarLength = 10
    let progress = 0

    const loadingBarInterval = setInterval(() => {
      progress += 1
      const progressBar =
        ":green_square:".repeat(progress) +
        ":white_large_square:".repeat(loadingBarLength - progress)
      loadingMessage.edit(
        `**Workflow started: ${repositoryOwner} / ${repositoryName}**\n\n:hourglass: In progress...\n\n${progressBar}`,
      )

      if (progress === loadingBarLength) {
        clearInterval(loadingBarInterval)
      }
    }, 1000)
    return loadingMessage
  }

  if (process.env.HUBOT_N8N_WEBHOOK) {
    if (discordClient.user) {
      const handleGuild = async (guild: Guild) => {
        await guild.members.fetch()

        const membersList: {
          username: string
          nickname: string | null
          id: string
        }[] = []

        guild.members.cache.forEach((member: GuildMember) => {
          membersList.push({
            username: member.user.username,
            nickname: member.nickname,
            id: member.id,
          })
        })

        const membersListString = encodeURIComponent(
          JSON.stringify(membersList),
        )

        const options = {
          headers: {
            workflowType: "member-list",
          },
        }

        await axios
          .get(`${webhookUrl}?membersList=${membersListString}`, options)
          .then(() => {
            robot.logger.info("Discord Memberlist sent to n8n")
          })
          .catch((error) => {
            robot.logger.info(`Memberlist failed to send: ${error.message}`)
          })
      }

      const storeMemberList = async () => {
        const guilds = Array.from(discordClient.guilds.cache.values())
        const guildPromises = guilds.map(handleGuild)
        await Promise.all(guildPromises)
      }

      storeMemberList()
    }

    // Use to build events when the user first connects to the discord server. WIP!
    // discordClient.on('guildMemberAdd', async (member) => {
    //   if (discordClient.channels) {
    //     const channel = member.guild.channels.cache.get("1099991409878126624")
    //     await channel.send({
    //       content: "**Welcome to the server! Let's get you onboarded to start**",
    //       ephemeral: true,
    //       components: [
    //         {
    //           type: 1,
    //           components: [
    //             {
    //               type: 2,
    //               label: "Start here",
    //               style: 1,
    //               custom_id: "start-onboarding",
    //             },
    //           ],
    //         },
    //       ],
    //     })
    //   }
    // })

    discordClient.on("interactionCreate", async (interaction) => {
      if (interaction.isModalSubmit()) {
        await interaction.reply({
          content: "Your form submission was received successfully!",
          ephemeral: true,
        })
        if (interaction.customId === "onboardingModal") {
          robot.logger.info(interaction)
          const firstName =
            interaction.fields.getTextInputValue("firstNameInput")
          const lastName = interaction.fields.getTextInputValue("lastNameInput")
          const email = interaction.fields.getTextInputValue("emailInput")
          robot.logger.info(firstName, lastName, email)
          robot.logger.info(interaction.user.id)

          const userData = [
            {
              firstName,
              lastName,
              email,
              id: interaction.user.id,
            },
          ]

          const userDataString = encodeURIComponent(JSON.stringify(userData))

          const options = {
            headers: {
              workflowType: "onboarding-user",
            },
          }

          await axios
            .get(`${webhookUrl}?onboarding=${userDataString}`, options)
            .then(() => {
              robot.logger.info("User onboarding info sent to n8n")
            })
            .catch((error) => {
              robot.logger.info(
                `User onboarding failed to send: ${error.message}`,
              )
            })
        }
      }

      if (
        interaction.isButton() &&
        interaction.customId.startsWith("start-onboarding")
      ) {
        const modal = new ModalBuilder()
          .setCustomId("onboardingModal")
          .setTitle("Onboarding Form")

        const firstNameInput = new TextInputBuilder()
          .setCustomId("firstNameInput")
          .setLabel("What's your first name?")
          .setStyle(TextInputStyle.Short)
        const lastNameInput = new TextInputBuilder()
          .setCustomId("lastNameInput")
          .setLabel("What's your last name?")
          .setStyle(TextInputStyle.Short)
        const emailInput = new TextInputBuilder()
          .setCustomId("emailInput")
          .setLabel("What is your work email?")
          .setStyle(TextInputStyle.Short)

        const firstActionRow =
          new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
            firstNameInput,
          )
        const secondActionRow =
          new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
            lastNameInput,
          )
        const thirdActionRow =
          new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
            emailInput,
          )

        modal.addComponents(firstActionRow, secondActionRow, thirdActionRow)
        await interaction.showModal(modal)
      }

      if (
        (interaction.isButton() && interaction.customId.startsWith("debug")) ||
        (interaction.isCommand() && interaction.commandName === "debug")
      ) {
        robot.logger.info("adapter in use:", robot.adapter)

        await interaction.reply({
          content: "**Debugger running, check your console ;)**",
          ephemeral: true,
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  label: "Run again",
                  style: 1,
                  custom_id: "debug",
                },
                {
                  type: 2,
                  label: "Onboarding",
                  style: 1,
                  custom_id: "start-onboarding",
                },
              ],
            },
          ],
        })
      }

      if (
        interaction.isCommand() &&
        interaction.commandName === "stale-issues"
      ) {
        const { channelId } = interaction
        const channel = discordClient.channels.cache.get(channelId)
        const repositoryOwnerOption =
          interaction.options.get("repository-owner")
        const repositoryNameOption = interaction.options.get("repository-name")
        if (
          repositoryOwnerOption &&
          typeof repositoryOwnerOption.value === "string" &&
          repositoryNameOption &&
          typeof repositoryNameOption.value === "string"
        ) {
          const repositoryOwner = repositoryOwnerOption.value
          const repositoryName = repositoryNameOption.value

          const queryParams = new URLSearchParams({
            repositoryOwner,
            repositoryName,
          })

          const loadingMessage = await startLoadingBar(
            interaction,
            repositoryOwner,
            repositoryName,
          )

          const options = {
            headers: {
              workflowType: "stale-issues",
            },
          }
          axios
            .get(`${webhookUrl}?${queryParams.toString()}`, options)
            .then(async (response) => {
              await loadingMessage.edit(
                `**Workflow: ${repositoryOwner} / ${repositoryName}**\n\n:white_check_mark: Workflow completed!`,
              )
              await loadingMessage.delete()
              if (channel instanceof TextChannel) {
                const thread = await channel.threads.create({
                  name: `Stale issues: ${repositoryOwner} ${repositoryName}`,
                  autoArchiveDuration: 60,
                })
                await thread.send(response.data)
              }
            })
            .catch((error) => {
              interaction.followUp(`workflow failed: ${error.message}`)
            })
        }
      }

      if (interaction.isCommand() && interaction.commandName === "issues") {
        const { channelId } = interaction
        const channel = discordClient.channels.cache.get(channelId)
        const repositoryOwnerOption =
          interaction.options.get("repository-owner")
        const repositoryNameOption = interaction.options.get("repository-name")
        if (
          repositoryOwnerOption &&
          typeof repositoryOwnerOption.value === "string" &&
          repositoryNameOption &&
          typeof repositoryNameOption.value === "string"
        ) {
          const repositoryOwner = repositoryOwnerOption.value
          const repositoryName = repositoryNameOption.value

          const queryParams = new URLSearchParams({
            repositoryOwner,
            repositoryName,
          })

          const loadingMessage = await startLoadingBar(
            interaction,
            repositoryOwner,
            repositoryName,
          )

          const options = {
            headers: {
              workflowType: "issues",
            },
          }
          axios
            .get(`${webhookUrl}?${queryParams.toString()}`, options)
            .then(async (response) => {
              await loadingMessage.edit(
                `**Workflow: ${repositoryOwner} / ${repositoryName}**\n\n:white_check_mark: Workflow completed!`,
              )
              await loadingMessage.delete()

              if (channel instanceof TextChannel) {
                const thread = await channel.threads.create({
                  name: `Issues: ${repositoryOwner} ${repositoryName}`,
                  autoArchiveDuration: 60,
                })
                await thread.send(response.data)
              }
            })
            .catch((error) => {
              interaction.followUp(`workflow failed: ${error.message}`)
            })
        }
      }

      if (interaction.isCommand() && interaction.commandName === "activity") {
        const { channelId } = interaction
        const channel = discordClient.channels.cache.get(channelId)
        const repositoryOwnerOption =
          interaction.options.get("repository-owner")
        const repositoryNameOption = interaction.options.get("repository-name")
        if (
          repositoryOwnerOption &&
          typeof repositoryOwnerOption.value === "string" &&
          repositoryNameOption &&
          typeof repositoryNameOption.value === "string"
        ) {
          const repositoryOwner = repositoryOwnerOption.value
          const repositoryName = repositoryNameOption.value

          const queryParams = new URLSearchParams({
            repositoryOwner,
            repositoryName,
          })

          const loadingMessage = await startLoadingBar(
            interaction,
            repositoryOwner,
            repositoryName,
          )

          const options = {
            headers: {
              workflowType: "activity",
            },
          }
          axios
            .get(`${webhookUrl}?${queryParams.toString()}`, options)
            .then(async (response) => {
              await loadingMessage.edit(
                `**Workflow: ${repositoryOwner} / ${repositoryName}**\n\n:white_check_mark: Workflow completed!`,
              )
              await loadingMessage.delete()

              if (channel instanceof TextChannel) {
                const thread = await channel.threads.create({
                  name: `Git Activity: ${repositoryOwner} ${repositoryName}`,
                  autoArchiveDuration: 60,
                })
                await thread.send("@here")
                await thread.send(response.data)
              }
            })
            .catch((error) => {
              interaction.followUp(`Workflow failed: ${error.message}`)
            })
        }
      }

      if (interaction.isCommand() && interaction.commandName === "n8n") {
        const { channelId } = interaction
        const channel = discordClient.channels.cache.get(channelId)
        const workflowNameOption = interaction.options.get("workflow-name")
        if (
          workflowNameOption &&
          typeof workflowNameOption.value === "string"
        ) {
          const workflowName = workflowNameOption.value

          const queryParams = new URLSearchParams({
            workflowName,
          })

          const loadingMessage = await startLoadingBar(
            interaction,
            workflowName,
            "running",
          )

          const options = {
            headers: {
              workflowType: "exec",
            },
          }
          axios
            .get(`${webhookUrl}?${queryParams.toString()}`, options)
            .then(async (response) => {
              await loadingMessage.edit(
                `**Workflow: ${workflowName}**\n\n:white_check_mark: Workflow completed!`,
              )
              await loadingMessage.delete()

              if (channel instanceof TextChannel) {
                const thread = await channel.threads.create({
                  name: `Exec: ${workflowName}`,
                  autoArchiveDuration: 60,
                })
                await thread.send("@here")
                await thread.send(response.data)
              }
            })
            .catch((error) => {
              interaction.followUp(`Workflow failed: ${error.message}`)
            })
        }
      }
    })
  }
}
