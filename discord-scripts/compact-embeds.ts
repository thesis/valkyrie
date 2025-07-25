import { Client, EmbedBuilder, Message, PartialMessage } from "discord.js"

async function generateCompactGitHubEmbeds(
	message: Message<boolean> | PartialMessage,
) {
	if (message.author === null || message.author === undefined) {
		return
	}

	if (!message.author.bot) {
		const receivedEmbeds = message.embeds
		if (
			!receivedEmbeds ||
			!receivedEmbeds.find(
				(embed) => embed.url && embed.url.includes("github.com"),
			)
		) {
			return
		}

		if (message.channel.isSendable()) {
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
}

// Suppresses default GitHub embeds in all Discord messages, replacing them
// with an extremely shortened version that only shows the page title with a
// link.
export default function compactGitHubEmbeds(discordClient: Client) {
	discordClient.on("messageCreate", (message) => {
		generateCompactGitHubEmbeds(message)
	})

	discordClient.on("messageUpdate", (_, newMessage) => {
		generateCompactGitHubEmbeds(newMessage)
	})
}
