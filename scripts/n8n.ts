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
        res.send(`n8n get issues: ${JSON.stringify(response.data)}`)
      })
      .catch((error) => {
        res.send(`n8n workflow failed: ${error.message}`)
      })
  })
}
