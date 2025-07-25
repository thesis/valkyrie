import {
	AnyThreadChannel,
	ApplicationCommandOptionType,
	Client,
	GuildTextBasedChannel,
	Role,
} from "discord.js"
import {
	DiscordEventHandlers,
	DiscordHubot,
	isInRecreationalCategory,
} from "../../lib/discord/utils.ts"

// When a thread is created, join it.
//
// Additionally, quietly tag a role so that all members of it are subscribed
// to the thread (they may later leave the thread to opt out). The role that
// is tagged is, in order:
//
// - If the containing channel's category is recreational, no role.
// - If the containnig channel has a role with a matching name, that role
//   (e.g., a message to #tech will tag a Tech role if it exists).
// - If the containing channel's category has a role with a matching name, that role
//   (e.g., a message to #taho-standup inside the Taho category will tag the
//   Taho role if it exists).
// - If the containing channel's category is General and the channel is
//   #main, @everyone.
//
// Quiet tags are achieved by dropping a placeholder message and then editing
// it to mention the right role. Discord's behavior in this scenario is not to
// ping the role, but to add all its members to the thread.

interface ChannelRoleMapping {
	channelName: string
	roles: string[]
}

const CUSTOM_CHANNEL_ROLE: ChannelRoleMapping[] = [
	{ channelName: "biz-dev-investor", roles: ["BD"] },
	{ channelName: "press-relations", roles: ["M Group", "Marketing"] },
	{ channelName: "mezo-marketing", roles: ["Mezo Marketing"] },
	{ channelName: "mezo-cathedral", roles: ["Mezo Cathedral"] },
	{ channelName: "mezo-ecosystem", roles: ["Mezo Ecosystem"] },
]

const AUTO_TAG_BRAIN_KEY = "auto-tag-roles"
const COMMAND_NAME = "auto-tag"
const ADD_SUBCOMMAND_NAME = "add"
const LIST_SUBCOMMAND_NAME = "list"
const REMOVE_SUBCOMMAND_NAME = "remove"

function getDefaultRoleForChannel(
	containingChannel: AnyThreadChannel["parent"],
	server: AnyThreadChannel["guild"],
): Role | null {
	if (!containingChannel) {
		return null
	}

	// Check hardcoded custom channel role mappings first
	const channelMapping = CUSTOM_CHANNEL_ROLE.find(
		(mapping) => mapping.channelName === containingChannel.name,
	)

	if (channelMapping && channelMapping.roles.length > 0) {
		const roleNames = channelMapping.roles
		const rolesToTag = roleNames
			.map((roleName) =>
				server.roles.cache.find(
					(role) => role.name.toLowerCase() === roleName.toLowerCase(),
				),
			)
			.filter((role): role is Role => role !== undefined)

		if (rolesToTag.length > 0) {
			return rolesToTag[0] // Return first matching role for display purposes
		}
	}

	// All prefixes of the containing channel name, with dashes converted to
	// spaces, ordered longest to shortest. For example, #mezo-engineering-musd
	// would produce ["mezo engineering musd", "mezo engineering", "mezo"].
	const roleMatchPrefixes = containingChannel.name
		.toLowerCase()
		.split("-")
		.reduce(
			(allPrefixes, nameSegment) => [
				...allPrefixes,
				`${allPrefixes.at(-1) ?? []} ${nameSegment}`.trim(),
			],
			[] as string[],
		)
		.reverse()

	const normalize = (str: string) =>
		str.toLowerCase().replace(/\s+/g, " ").trim()

	const matchingRole = server.roles.cache.find((role) =>
		roleMatchPrefixes.some(
			(channelPrefixRole) =>
				normalize(role.name) === normalize(channelPrefixRole),
		),
	)

	if (matchingRole !== undefined) {
		return matchingRole
	}

	const categoryChannel = containingChannel.parent
	const categoryMatchingRole = server.roles.cache.find(
		(role) => normalize(role.name) === normalize(categoryChannel?.name || ""),
	)

	if (categoryMatchingRole !== undefined) {
		return categoryMatchingRole
	}

	if (
		categoryChannel?.name?.toLowerCase()?.endsWith("general") === true &&
		(containingChannel.name?.toLowerCase()?.endsWith("main") === true ||
			containingChannel.name?.toLowerCase()?.endsWith("bifrost") === true)
	) {
		return server.roles.everyone
	}

	return null
}

async function autoJoinThread(
	thread: AnyThreadChannel,
	robot?: DiscordHubot,
): Promise<void> {
	await thread.join()

	if (isInRecreationalCategory(thread)) {
		return
	}

	const { guild: server, parent: containingChannel } = thread
	
	if (!thread.isSendable()) {
		return
	}

	const placeholder = await thread.send("<placeholder>")

	// Check for custom auto-tag roles first
	if (robot && containingChannel) {
		const autoTagData = robot.brain.get(AUTO_TAG_BRAIN_KEY) ?? {}
		const customRoles: string[] = autoTagData[containingChannel.id] ?? []

		if (customRoles.length > 0) {
			const rolesToTag = customRoles
				.map((roleName) =>
					server.roles.cache.find(
						(role) => role.name.toLowerCase() === roleName.toLowerCase(),
					),
				)
				.filter((role): role is Role => role !== undefined)

			if (rolesToTag.length > 0) {
				const roleMentions = rolesToTag.map((role) => role.toString()).join(" ")
				await placeholder.edit(roleMentions)
				return
			}
		}
	}

	// Fall back to default role resolution logic
	const defaultRole = getDefaultRoleForChannel(containingChannel, server)
	if (defaultRole !== null) {
		await placeholder.edit(defaultRole.toString())
		return
	}

	// If we hit this spot, be a monster and delete the useless placeholder and
	// pray for our soul. Placeholder code as we figure out the best way to
	// handle the General category.
	await placeholder.delete()
}


export default async function autoJoinAndTagManagement(
	discordClient: Client,
	robot: DiscordHubot,
) {
	robot.logger.info("Configuring auto-join and auto-tag management...")

	const { application } = discordClient
	if (application === null) {
		robot.logger.error(
			"Failed to resolve Discord application, dropping auto-tag command handling.",
		)
		return
	}

	const existingAutoTagCommand = (
		await application.commands.fetch()
	).find((command) => command.name === COMMAND_NAME)

	if (existingAutoTagCommand === undefined) {
		robot.logger.info("No auto-tag command yet, creating it!")
		await application.commands.create({
			name: COMMAND_NAME,
			description: "Manage roles that are auto-tagged in new threads for this channel.",
			options: [
				{
					name: ADD_SUBCOMMAND_NAME,
					type: ApplicationCommandOptionType.Subcommand,
					description: "Add a role to be auto-tagged in new threads for this channel.",
					options: [
						{
							name: "role",
							type: ApplicationCommandOptionType.String,
							description: "The name of the role to add.",
							required: true,
							autocomplete: true,
						},
					],
				},
				{
					name: LIST_SUBCOMMAND_NAME,
					type: ApplicationCommandOptionType.Subcommand,
					description: "List roles that will be auto-tagged in new threads for this channel.",
				},
				{
					name: REMOVE_SUBCOMMAND_NAME,
					type: ApplicationCommandOptionType.Subcommand,
					description: "Remove a role from being auto-tagged in new threads for this channel.",
					options: [
						{
							name: "role",
							type: ApplicationCommandOptionType.String,
							description: "The name of the role to remove.",
							required: true,
							autocomplete: true,
						},
					],
				},
			],
		})

		robot.logger.info("Created auto-tag command.")
	}

	// Handle auto-tag slash command interactions
	discordClient.on("interactionCreate", async (interaction) => {
		if (
			interaction.isChatInputCommand() &&
			interaction.commandName === COMMAND_NAME &&
			interaction.channel !== null &&
			!interaction.channel.isDMBased()
		) {
			const subcommand = interaction.options.getSubcommand()
			const { channel } = interaction

			try {
				// Check if user has permission to manage threads
				if (!interaction.memberPermissions?.has('MANAGE_CHANNELS')) {
					await interaction.reply({
						content: "You need the Manage Channels permission to use this command.",
						ephemeral: true
					});
					return;
				}
				if (subcommand === ADD_SUBCOMMAND_NAME) {
					const roleName = interaction.options.getString("role", true)
					const server = interaction.guild

					if (!server) {
						await interaction.reply({
							content: "This command can only be used in a server.",
							ephemeral: true,
						})
						return
					}

					// Verify the role exists
					const role = server.roles.cache.find(
						(r) => r.name.toLowerCase() === roleName.toLowerCase(),
					)

					if (!role) {
						await interaction.reply({
							content: `Role "${roleName}" not found in this server.`,
							ephemeral: true,
						})
						return
					}

					// Add role to auto-tag list for this channel
					const autoTagData = robot.brain.get(AUTO_TAG_BRAIN_KEY) ?? {}
					const channelRoles: string[] = autoTagData[channel.id] ?? []

					if (!channelRoles.includes(role.name)) {
						channelRoles.push(role.name)
						autoTagData[channel.id] = channelRoles
						robot.brain.set(AUTO_TAG_BRAIN_KEY, autoTagData)

						await interaction.reply({
							content: `Added role "${role.name}" to auto-tag list for this channel.`,
						})
					} else {
						await interaction.reply({
							content: `Role "${role.name}" is already in the auto-tag list for this channel.`,
							ephemeral: true,
						})
					}
				} else if (subcommand === LIST_SUBCOMMAND_NAME) {
					const autoTagData = robot.brain.get(AUTO_TAG_BRAIN_KEY) ?? {}
					const channelRoles: string[] = autoTagData[channel.id] ?? []

					if (channelRoles.length > 0) {
						const roleList = channelRoles.map((role) => `• ${role}`).join("\n")
						await interaction.reply({
							content: `**Custom auto-tag roles for this channel:**\n${roleList}`,
						})
					} else {
						// Show default role that would be used
						const server = interaction.guild
						if (server) {
							const defaultRole = getDefaultRoleForChannel(channel as AnyThreadChannel["parent"], server)
							if (defaultRole) {
								await interaction.reply({
									content: `**No custom auto-tag roles set for this channel.**\n\nDefault role that would be auto-tagged: **${defaultRole.name}**`,
								})
							} else {
								await interaction.reply({
									content: "**No custom auto-tag roles set for this channel.**\n\nNo default role would be auto-tagged.",
								})
							}
						} else {
							await interaction.reply({
								content: "This command can only be used in a server.",
								ephemeral: true,
							})
						}
					}
				} else if (subcommand === REMOVE_SUBCOMMAND_NAME) {
					const roleName = interaction.options.getString("role", true)
					const autoTagData = robot.brain.get(AUTO_TAG_BRAIN_KEY) ?? {}
					const channelRoles: string[] = autoTagData[channel.id] ?? []

					const roleIndex = channelRoles.findIndex(
						(role) => role.toLowerCase() === roleName.toLowerCase(),
					)

					if (roleIndex !== -1) {
						const removedRole = channelRoles.splice(roleIndex, 1)[0]
						autoTagData[channel.id] = channelRoles
						robot.brain.set(AUTO_TAG_BRAIN_KEY, autoTagData)

						await interaction.reply({
							content: `Removed role "${removedRole}" from auto-tag list for this channel.`,
						})
					} else {
						await interaction.reply({
							content: `Role "${roleName}" is not in the auto-tag list for this channel.`,
							ephemeral: true,
						})
					}
				}
			} catch (error) {
				robot.logger.error("Error handling auto-tag command:", error)
				await interaction.reply({
					content: "An error occurred while processing the command.",
					ephemeral: true,
				})
			}
		}
	})

	// Handle autocomplete interactions for role selection
	discordClient.on("interactionCreate", async (interaction) => {
		if (
			interaction.isAutocomplete() &&
			interaction.commandName === COMMAND_NAME &&
			interaction.guild !== null &&
			interaction.channel !== null
		) {
			const focusedOption = interaction.options.getFocused(true)
			
			if (focusedOption.name === "role") {
				const { guild, channel } = interaction
				const userInput = focusedOption.value.toLowerCase()
				const subcommand = interaction.options.getSubcommand()
				
				let matchingRoles: { name: string; value: string }[] = []
				
				if (subcommand === REMOVE_SUBCOMMAND_NAME) {
					// For remove command, prioritize roles already in auto-tag list
					const autoTagData = robot.brain.get(AUTO_TAG_BRAIN_KEY) ?? {}
					const channelRoles: string[] = autoTagData[channel.id] ?? []
					
					matchingRoles = channelRoles
						.filter(roleName => roleName.toLowerCase().includes(userInput))
						.map(roleName => ({
							name: roleName,
							value: roleName,
						}))
					
					// If we have space, add other server roles not in the list
					if (matchingRoles.length < 25) {
						const additionalRoles = guild.roles.cache
							.filter(role => 
								role.name !== "@everyone" && 
								!role.managed && 
								!channelRoles.includes(role.name) &&
								role.name.toLowerCase().includes(userInput)
							)
							.map(role => ({
								name: role.name,
								value: role.name,
							}))
							.slice(0, 25 - matchingRoles.length)
						
						matchingRoles = [...matchingRoles, ...additionalRoles]
					}
				} else {
					// For add command, show all available roles
					matchingRoles = guild.roles.cache
						.filter(role => 
							// Exclude @everyone and bot roles, and filter by name matching user input
							role.name !== "@everyone" && 
							!role.managed && 
							role.name.toLowerCase().includes(userInput)
						)
						.map(role => ({
							name: role.name,
							value: role.name,
						}))
						.slice(0, 25) // Discord limits to 25 autocomplete options
				}

				try {
					await interaction.respond(matchingRoles)
				} catch (error) {
					robot.logger.error("Error responding to autocomplete:", error)
				}
			}
		}
	})

	// Set up thread creation event handler
	const eventHandlers: DiscordEventHandlers = {
		threadCreate: (thread: AnyThreadChannel) => autoJoinThread(thread, robot),
	}

	robot.logger.info("Auto-join and auto-tag management configured.")
	return eventHandlers
}
