import axios from 'axios'
import { Robot } from "hubot"

export default function n8nIssues(robot: Robot) {
  // Runs an n8n automation to output specific list of issues based on input valkyrie issues <repo owner> <repo name>
  robot.respond(/issues (\S+) (\S+)/i, (res) => {
    const repositoryOwner = res.match[1]
    const repositoryName = res.match[2]
    const webhookUrl = 'http://n8n.thesis.co/webhook/b6ab512e-8229-43ce-b0cb-5e2dd037fd92'

    const queryParams = new URLSearchParams({
      repositoryOwner: repositoryOwner,
      repositoryName: repositoryName,
    })

    axios.get(`${webhookUrl}?${queryParams.toString()}`)
      .then((response) => {
        res.send(`n8n get recent issues: ${JSON.stringify(response.data)}`)
      })
      .catch((error) => {
        res.send(`n8n workflow failed: ${error.message}`)
      })
  })

  robot.respond(/stale-issues (\S+) (\S+)/i, (res) => {
    const repositoryOwner = res.match[1]
    const repositoryName = res.match[2]
    const webhookUrl = 'http://n8n.thesis.co/webhook/ec766fde-4ce5-4679-8a50-462e9e68e16a'

    const queryParams = new URLSearchParams({
      repositoryOwner: repositoryOwner,
      repositoryName: repositoryName,
    })

    axios.get(`${webhookUrl}?${queryParams.toString()}`)
      .then((response) => {
        res.send(`n8n get stale issues: ${JSON.stringify(response.data)}`)
      })
      .catch((error) => {
        res.send(`n8n test failed: ${error.message}`)
      })
  })

  robot.respond(/activity (\S+) (\S+)/i, (res) => {
    const repositoryOwner = res.match[1]
    const repositoryName = res.match[2]
    const webhookUrl = 'http://n8n.thesis.co/webhook/8efb5ea2-13e0-4348-a32a-cba2c35114a5'

    const queryParams = new URLSearchParams({
      repositoryOwner: repositoryOwner,
      repositoryName: repositoryName,
    })

    axios.get(`${webhookUrl}?${queryParams.toString()}`)
      .then((response) => {
        res.send(`n8n get git activity: ${JSON.stringify(response.data)}`)
      })
      .catch((error) => {
        res.send(`n8n test failed: ${error.message}`)
      })
  })

  robot.respond(/help$/i, (res) => {
    res.send("**These are the commands that have been implemented so far:**",'\n'," - Grab latest issues with: `valkyrie-test issues <repo owner> <repo name>`",'\n'," - Get stale issues with `valkyrie-test stale-issues <repo owner> <repo name>`",'\n'," - Get activity stats `valkyrie-test activity <repo owner> <repo name>`",'\n'," - Run custom workflow `valkyrie-test exec <workflowname>`")
  })

  robot.respond(/morning$/i, (res) => {
    res.send("** :wave: Well Good morning to you too! You can type `fjord help` to get to know your way around**")
  })

  robot.respond(/exec (\S+)/i, (res) => {
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
