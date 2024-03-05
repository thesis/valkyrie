import {
  Client,
  GuildChannel,
  PermissionOverwrites,
  TextChannel,
} from "discord.js"
import { Robot } from "hubot"

export default async function manageChannelPermissions(
  discordClient: Client,
  robot: Robot,
) {
  const { application } = discordClient

  if (application) {
    discordClient.on("channelCreate", async (channel) => {
      if (channel.parent && channel.parent.name === "defense") {
        const permissions = channel.parent.permissionOverwrites.cache
        await channel.permissionOverwrites.set(permissions)
        robot.logger.info("Channel permissions set to base category")
        sendChannelPermissions(channel, permissions)
      }
    })
  }
}

async function sendChannelPermissions(
  channel: GuildChannel,
  permissions: Map<string, PermissionOverwrites>,
) {
  if (channel.parent && channel.parent.name === "defense") {
    const textChannel = channel as TextChannel
    let permissionsText =
      "This channel is now configured with the following permissions from the base category:\n"
    permissions.forEach((perm: PermissionOverwrites, key: string) => {
      const roleName =
        channel.guild.roles.cache.get(perm.id)?.name || "Unknown Role/User"
      const allowedPermissions =
        perm.allow.toArray().join(", ") || "no permissions"
      const deniedPermissions =
        perm.deny.toArray().join(", ") || "no permissions"
      permissionsText += `${roleName}: Allow: ${allowedPermissions} | Deny: ${deniedPermissions}\n`
    })
    await textChannel.send(permissionsText)
  }
}
