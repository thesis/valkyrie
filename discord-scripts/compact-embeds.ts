import { PartialMessage, Client, Message, EmbedBuilder } from "discord.js"

async function compactGithubEmbeds(message: Message<boolean> | PartialMessage) {
  if (message.author === null || message.author === undefined) {
    return
  }

  if (!message.author.bot) {
    const receivedEmbeds = message.embeds
    if (
      !receivedEmbeds ||
      !receivedEmbeds.find((embed) => embed.url && embed.url.includes("github"))
    ) {
      return
    }

    await message.suppressEmbeds(true)
    const description = receivedEmbeds
      .map((embed, i) => `(${i + 1}) [${embed.title}](${embed.url})`)
      .join("\n")
    const embed = new EmbedBuilder()
      .setColor("#0099ff")
      .setDescription(description)

    message.channel.send({ embeds: [embed] })
  }
}

// Suppresses default GitHub embeds in all Discord messages, replacing them
// with an extremely shortened version that only shows the page title with a
// link.
export default function compactGitHubEmbeds(discordClient: Client) {
  discordClient.on("messageCreate", (message) => {
    compactGithubEmbeds(message)
  })

  discordClient.on("messageUpdate", (message) => {
    compactGithubEmbeds(message)
  })
}
