import { ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, Channel, ChannelType, Client, Message } from "discord.js"
import axios from 'axios'
import { Robot } from "hubot"

export default function manageFjord(discordClient: Client, robot: Robot) {

  // test fjord replies into new thread
  discordClient.on("threadCreate", async (thread) => {
    await thread.join()

    const { guild: server, parent: containingChannel } = thread

  })

  discordClient.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const buttonID = interaction.customId
        if (buttonID === 'ping') {
            interaction.reply({
                content: 'pong'
              })
          }
        if (buttonID === 'debug') {
            interaction.reply({
                content: '!debug'
              })
          }
        if (buttonID === 'stale-issues') {
            interaction.reply({
                content: '!stale-issues'
              })
          }

      }
  })

  // test message commands without need for hubot responses for fjord
  discordClient.on("messageCreate", async (message) => {

    const { channel } = message

    const handleThreadCreate = async (message: any, threadName: any, threadReason: any, responseData: any) => {
      const debugThread = await message.startThread({
        name: threadName,
        autoArchiveDuration: 60,
        reason: threadReason,
      })
      await debugThread.send("Over here!")
      await debugThread.send(responseData)
    }

    if (message.content === "!ping") {
      channel.send("ping pong ping / o \ o")
      channel.send({
                "content": "ping pong ping",
                "components": [
                    {
                        "type": 1,
                        "components": [
                            {
                                "type": 2,
                                "label": "Ping?",
                                "style": 1,
                                "custom_id": "ping"
                            }
                        ]

                    }
                ]
            })
    }

    if (message.content === "!debug") {
      console.log("adapter in use:", robot.adapter)
      channel.send({
                "content": "**Debugger running, check your console ;)**",
                "components": [
                    {
                        "type": 1,
                        "components": [
                            {
                                "type": 2,
                                "label": "Run debugger again",
                                "style": 1,
                                "custom_id": "debug"
                            }
                        ]

                    }
                ]
            })
    }

    if (message.content === "!fjord") {
      channel.send("**Fjord is listening, what do you want?**")
    }

    if (message.content === "!thread") {
      const threadName = "Testing 1 2 3"
      await handleThreadCreate(message, threadName, "thread test", "test")
    }

    if (message.content.startsWith("!stale-issues")) {
      const parameters = message.content.split(" ").slice(1)
      if (parameters.length >= 2) {
        const [repositoryOwner, repositoryName] = parameters
        const webhookUrl = 'http://n8n.thesis.co/webhook/ec766fde-4ce5-4679-8a50-462e9e68e16a'
        const queryParams = new URLSearchParams({
          repositoryOwner: repositoryOwner,
          repositoryName: repositoryName,
        })
        message.reply(`**Stale issue automation started:  ${repositoryOwner} / ${repositoryName}**`)
        axios.get(`${webhookUrl}?${queryParams.toString()}`)
          .then(async (response) => {
            const threadName = `${repositoryOwner}/${repositoryName} - Stale issues`
            await handleThreadCreate(message, threadName, "stale issues", response.data )
          })
          .catch((error) => {
            channel.send(`Automation stale-issues flow failed: ${error.message}`)
          })

      } else {
        channel.send("**Please provide these parameters: !stale-issues <username> <repo> **");
      }
    }

      robot.respond(/debug$/i, async (res) => {
        res.reply("**Running the debugger, check your console output**")
        console.log("adapter in use:", robot.adapter)
        const threadName = "Debugging results"
        await handleThreadCreate(message, threadName, "Debugging test", "test 1 2 3" )
      })

  })

    // run hubot commands to interact directly with n8n & debugger


    robot.respond(/issues (\S+) (\S+)/i, async (res) => {
      const repositoryOwner = res.match[1]
      const repositoryName = res.match[2]
      const webhookUrl = 'http://n8n.thesis.co/webhook/b6ab512e-8229-43ce-b0cb-5e2dd037fd92'


      const queryParams = new URLSearchParams({
        repositoryOwner: repositoryOwner,
        repositoryName: repositoryName,
      })

      res.reply("**Running Git get issues**")

      axios.get(`${webhookUrl}?${queryParams.toString()}`)
        .then((response) => {
          res.send(`n8n get recent issues: ${JSON.stringify(response.data)}`)
        })
        .catch((error) => {
          res.send(`n8n workflow failed: ${error.message}`)
        })
    })

    // robot.respond(/stale-issues (\S+) (\S+)/i, async (res) => {
    //   const repositoryOwner = res.match[1]
    //   const repositoryName = res.match[2]
    //   const webhookUrl = 'http://n8n.thesis.co/webhook/ec766fde-4ce5-4679-8a50-462e9e68e16a'
    //
    //   const queryParams = new URLSearchParams({
    //     repositoryOwner: repositoryOwner,
    //     repositoryName: repositoryName,
    //   })
    //   res.reply(`**Running n8n workflow to retrieve stale issues from ${repositoryOwner}/${repositoryName}  **`)
    //   axios.get(`${webhookUrl}?${queryParams.toString()}`)
    //     .then(async (response) => {
    //       discordClient.on("messageCreate", async (message) => {
    //         const { channel } = message
    //         const debugThread = await message.startThread({
    //             name: `${repositoryOwner} / ${repositoryName} `,
    //             autoArchiveDuration: 60,
    //             reason: 'Stale issues automation'
    //         });
    //         await debugThread.send("Over here!")
    //         await debugThread.send(`n8n get stale issues: `)
    //       })
    //       await res.send(`n8n get stale issues: `)
    //       await res.send(`${response.data}`)
    //     })
    //     .catch((error) => {
    //       res.send(`n8n test failed: ${error.message}`)
    //     })
    //
    // })

    robot.respond(/activity (\S+) (\S+)/i, async (res) => {
      const repositoryOwner = res.match[1]
      const repositoryName = res.match[2]
      const webhookUrl = 'http://n8n.thesis.co/webhook/8efb5ea2-13e0-4348-a32a-cba2c35114a5'

      const queryParams = new URLSearchParams({
        repositoryOwner: repositoryOwner,
        repositoryName: repositoryName,
      })
      res.reply("**Running Git get activity**")
      axios.get(`${webhookUrl}?${queryParams.toString()}`)
        .then((response) => {
          res.send(`n8n get git activity: ${JSON.stringify(response.data)}`)
        })
        .catch((error) => {
          res.send(`n8n test failed: ${error.message}`)
        })
    })

    robot.respond(/exec (\S+)/i, async (res) => {
      const workflowName = res.match[1]
      const webhookUrl = 'http://n8n.thesis.co/webhook/a696e0de-998f-4700-a010-12790ab81175'

      const queryParams = new URLSearchParams({
        workflowName: workflowName
      })

      axios.get(`${webhookUrl}?${queryParams.toString()}`)
        .then((response) => {
          res.send(`n8n run workflow: ${JSON.stringify(response.data)}`)
        })
        .catch((error) => {
          res.send(`n8n test failed: ${error.message}`)
        })
    })

}
