import { ApplicationCommandOptionType, Channel, ChannelType, Client } from "discord.js"
import axios from 'axios'
import { Robot } from "hubot"

export default function manageFjord(discordClient: Client, robot: Robot) {
  // test fjord replies into new thread
  discordClient.on("threadCreate", async (thread) => {
    await thread.join()

    const { guild: server, parent: containingChannel } = thread

    await thread.send("**Fjord is here, listening, waiting for something to automate!**")

  })

  // test message commands without need for hubot responses for fjord
  discordClient.on("messageCreate", async (message) => {
    const { channel } = message

    if (message.content === "!ping") {
      channel.send("ping pong ping / o \ o")
    }

    if (message.content === "!debug") {
      channel.send("**Debugger running, check your console ;)**")
      console.log("adapter in use:", robot.adapter)
    }

    if (message.content === "!fjord") {
      channel.send("**Fjord is listening, what do you want?**")
    }

    if (message.content === "!thread") {
      const discussThread = await message.startThread({
            name: 'F J O R D - T H R E A D!',
            autoArchiveDuration: 60,
            reason: 'test'
        });
        discussThread.send("Over here!")
    }

  })

    // run hubot commands to interact directly with n8n & debugger

    robot.respond(/debug$/i, async (res) => {
      res.reply("**Running the debugger, check your console output**")
      console.log("adapter in use:", robot.adapter)
      discordClient.on("messageCreate", async (message) => {
        const { channel } = message
        const debugThread = await message.startThread({
            name: 'Debug results',
            autoArchiveDuration: 60,
            reason: 'test'
        });
        await debugThread.send("Over here!")
        await debugThread.send("**Debugging complete, check out the logs!**")
      })
    })

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

    robot.respond(/stale-issues (\S+) (\S+)/i, async (res) => {
      const repositoryOwner = res.match[1]
      const repositoryName = res.match[2]
      const webhookUrl = 'http://n8n.thesis.co/webhook/ec766fde-4ce5-4679-8a50-462e9e68e16a'

      const queryParams = new URLSearchParams({
        repositoryOwner: repositoryOwner,
        repositoryName: repositoryName,
      })
      res.reply(`**Running n8n workflow to retrieve stale issues from ${repositoryOwner}/${repositoryName}  **`)
      axios.get(`${webhookUrl}?${queryParams.toString()}`)
        .then((response) => {
          res.send(`n8n get stale issues: ${JSON.stringify(response.data)}`)
        })
        .catch((error) => {
          res.send(`n8n test failed: ${error.message}`)
        })
    })

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
