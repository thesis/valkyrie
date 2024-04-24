import { Robot } from "hubot"
import {
  Client,
  TextChannel,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from "discord.js"
import { DAY, MILLISECOND, WEEK } from "../lib/globals.ts"

const EXTERNAL_AUDIT_CHANNEL_REGEXP = /^ext-(?<client>.*)-audit$/

const employeeQuestion = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId("employee-yes")
    .setLabel("Yes")
    .setStyle(ButtonStyle.Success),
  new ButtonBuilder()
    .setCustomId("employee-no")
    .setLabel("No")
    .setStyle(ButtonStyle.Danger),
)

const disciplineQuestion = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId("engineering")
    .setLabel("Engineering")
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId("design")
    .setLabel("Design")
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId("product")
    .setLabel("Product")
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId("marketing")
    .setLabel("Marketing")
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId("business")
    .setLabel("Business Development")
    .setStyle(ButtonStyle.Primary),
)

const projectQuestion = new ActionRowBuilder<ButtonBuilder>().addComponents(
  new ButtonBuilder()
    .setCustomId("mezo")
    .setLabel("Mezo")
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId("acre")
    .setLabel("Acre")
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId("embody")
    .setLabel("Embody")
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId("tbtc")
    .setLabel("tBTC")
    .setStyle(ButtonStyle.Primary),
  new ButtonBuilder()
    .setCustomId("thesis")
    .setLabel("Thesis*")
    .setStyle(ButtonStyle.Primary),
)

interface Invitation {
  project?: string
  discipline?: string
}

const invitation: Invitation = {}

async function createInvite(
  channel: TextChannel,
  maxAge = (1 * WEEK) / MILLISECOND,
  maxUses = 10,
): Promise<{ url: string; maxAge: number; maxUses: number }> {
  const invite = await channel.createInvite({
    maxAge,
    maxUses,
    unique: true,
  })

  return {
    url: invite.url,
    maxAge,
    maxUses,
  }
}

export default async function sendInvite(discordClient: Client, robot: Robot) {
  const { application } = discordClient

  if (application) {
    // Check if create-invite command already exists, if not create it
    const existingInviteCommand = (await application.commands.fetch()).find(
      (command) => command.name === "create-invite",
    )
    if (existingInviteCommand === undefined) {
      robot.logger.info("No create-invite command found, creating it!")
      await application.commands.create({
        name: "create-invite",
        description: "Creates a new invite",
      })
      robot.logger.info("create invite command set")
    }
    // Create an invite based of the command and channel where the command has been run
    discordClient.on("interactionCreate", async (interaction) => {
      if (
        !interaction.isCommand() ||
        interaction.commandName !== "create-invite"
      ) {
        return
      }

      if (!interaction.guild) {
        await interaction.reply("This command can only be used in a server.")
        return
      }

      // Reply to the interaction asking if this is a thesis employee/contractor
      await interaction.reply({
        content: "**Is this a Thesis employee or contractor?**",
        components: [employeeQuestion],
        ephemeral: true,
      })
    })

    discordClient.on("interactionCreate", async (interaction) => {
      if (!interaction.isButton()) return

      if (!interaction.guild) {
        await interaction.reply(
          "This interaction can only be used in a server.",
        )
        return
      }

      const { channel } = interaction
      if (!(channel instanceof TextChannel)) {
        await interaction.reply(
          "Cannot create an invite for this type of channel.",
        )
        return
      }
      // generate an invite for base role
      if (interaction.customId === "employee-no") {
        try {
          invitation.project = "Thesis Base"
          const invite = await createInvite(
            channel,
            (1 * WEEK) / MILLISECOND,
            1,
          )
          const internalInviteExpiry = Math.floor(
            Date.now() / 1000 + invite.maxAge,
          )
          await interaction.update({
            content: `**We've generated an invite code for @${invitation.project}} role**, : ${invite.url}\nThis invite expires <t:${internalInviteExpiry}:R> and has a maximum of ${invite.maxUses} uses.`,
            components: [],
          })
        } catch (error) {
          console.error(error)
          await interaction.reply(
            "An error occurred while creating the invite.",
          )
        }
      }
      if (interaction.customId === "employee-yes") {
        await interaction.update({
          content:
            "**For a Thesis employee: which discipline(s) will this person be working with?**",
          components: [disciplineQuestion],
        })
        invitation.discipline = await interaction.customId
      }

      if (
        interaction.customId === "engineering" ||
        interaction.customId === "design" ||
        interaction.customId === "product" ||
        interaction.customId === "marketing" ||
        interaction.customId === "business"
      ) {
        invitation.discipline = await interaction.customId
        robot.logger.info(invitation.discipline)
        await interaction.update({
          content:
            "**For a Thesis employee: which projects will this person be working on?**",
          components: [projectQuestion],
        })
      }

      if (
        interaction.customId === "mezo" ||
        interaction.customId === "acre" ||
        interaction.customId === "embody" ||
        interaction.customId === "tbtc" ||
        interaction.customId === "thesis"
      ) {
        invitation.project = await interaction.customId
        robot.logger.info(invitation.project)
        robot.logger.info(invitation.project, invitation.discipline)
        const targetChannelName = `🔒${invitation.project ?? ""}-${
          invitation.discipline ?? ""
        }`
        robot.logger.info(targetChannelName)
        const matchChannel = interaction.guild.channels.cache.find(
          (c) => c.name === targetChannelName,
        ) as TextChannel
        robot.logger.info(matchChannel)
        try {
          const invite = await createInvite(
            matchChannel,
            (1 * WEEK) / MILLISECOND,
            1,
          )
          const internalInviteExpiry = Math.floor(
            Date.now() / 1000 + invite.maxAge,
          )
          await interaction.update({
            content: `**We've generated an invite code for <@${interaction.customId}> role**, : ${invite.url}\nThis invite expires <t:${internalInviteExpiry}:R> and has a maximum of ${invite.maxUses} uses.`,
            components: [],
          })
        } catch (error) {
          console.error(error)
          await interaction.reply(
            "An error occurred while creating the invite.",
          )
        }
      }
    })

    // Generates an invite if the channel name matches ext-*-audit format
    discordClient.on("channelCreate", async (channel) => {
      if (
        channel.parent &&
        channel.parent.name === "defense" &&
        channel instanceof TextChannel &&
        EXTERNAL_AUDIT_CHANNEL_REGEXP.test(channel.name)
      ) {
        try {
          const defenseInvite = await createInvite(channel)
          if (defenseInvite) {
            robot.logger.info(
              `New invite created for defense audit channel: ${channel.name}, URL: ${defenseInvite.url}`,
            )
            channel.send(
              `Here is your invite link: ${
                defenseInvite.url
              }\nThis invite expires in ${
                (defenseInvite.maxAge / DAY) * MILLISECOND
              } days and has a maximum of ${defenseInvite.maxUses} uses.`,
            )
          }
          // Create a new role with the client name extracted and set permissions to that channel
          const clientName = channel.name
            .split("-")
            .slice(1, -1)
            .map(
              (segment) =>
                segment.substring(0, 1).toUpperCase() + segment.substring(1),
            )
            .join(" ")

          if (clientName) {
            const roleName = clientName
              ? `Defense: ${clientName}`
              : `Defense: ${channel.name}`

            const role = await channel.guild.roles.create({
              name: roleName,
              reason: `Role for ${channel.name} channel`,
            })

            await channel.permissionOverwrites.create(role, {
              ViewChannel: true,
            })
            channel.send(
              `**${role.name}** role created and permissions set for **${channel.name}**`,
            )
            robot.logger.info(
              `${role.name} role created and permissions set for channel ${channel.name}`,
            )
          } else {
            robot.logger.info(
              `Skipping role creation due to empty client name for channel ${channel.name}`,
            )
          }
        } catch (error) {
          robot.logger.error(
            `An error occurred setting up the defense audit channel: ${error}`,
          )
        }
      }
    })
  }
}
