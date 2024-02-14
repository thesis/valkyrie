import { Client } from "discord.js"

export default async function manageRole(
  discordClient: Client,
  guildId: string,
  memberId: string,
  roleId: string,
  action: "add" | "remove",
): Promise<void> {
  if (!discordClient) {
    throw new Error("Discord client is not initialized.")
  }

  const guild = await discordClient.guilds.fetch(guildId)
  if (!guild) throw new Error("Guild not found.")

  const member = await guild.members.fetch(memberId)
  if (!member) throw new Error("Member not found.")

  const role = await guild.roles.fetch(roleId)
  if (!role) throw new Error("Role not found.")

  if (action === "add") {
    if (member.roles.cache.has(roleId)) {
      return
    }
    await member.roles.add(role)
  } else if (action === "remove") {
    if (!member.roles.cache.has(roleId)) {
      return
    }
    await member.roles.remove(role)
  }
}
