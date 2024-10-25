import { AnyThreadChannel, Role } from "discord.js"
import {
  DiscordEventHandlers,
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

const CUSTOM_CHANNEL_ROLE: Record<string, string> = {
  // hiring: "PeopleOps",
  "biz-dev-investor": "BD",
  "press-relations": "M Group, Marketing",
}

const hasCustomChannels = Object.keys(CUSTOM_CHANNEL_ROLE).length > 0

async function autoJoinThread(
  thread: AnyThreadChannel<boolean>,
): Promise<void> {
  await thread.join()

  if (isInRecreationalCategory(thread)) {
    return
  }

  const { guild: server, parent: containingChannel } = thread

  const placeholder = await thread.send("<placeholder>")

  // Use this to assign a specific role based on the mapping in CUSTOM_CHANNEL_ROLE, in order to map specific roles/channels
  if (hasCustomChannels && containingChannel) {
    const roleNames = CUSTOM_CHANNEL_ROLE[containingChannel.name]
      ?.split(",")
      .map((role) => role.trim())

    if (roleNames && roleNames.length > 0) {
      const rolesToTag = roleNames
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

  // All prefixes of the containing channel name, with dashes converted to
  // spaces, ordered longest to shortest. For example, #mezo-engineering-musd
  // would produce ["mezo engineering musd", "mezo engineering", "mezo"].
  const roleMatchPrefixes = containingChannel?.name
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

  const matchingRole = server.roles.cache.find(
    (role) =>
      roleMatchPrefixes?.some(
        (channelPrefixRole) =>
          role.name.toLowerCase() ===
          channelPrefixRole /* already lowercased above */,
      ),
  )

  if (matchingRole !== undefined) {
    await placeholder.edit(matchingRole.toString())
    return
  }

  const categoryChannel = containingChannel?.parent
  const categoryMatchingRole = server.roles.cache.find(
    (role) => role.name.toLowerCase() === categoryChannel?.name.toLowerCase(),
  )

  if (categoryMatchingRole !== undefined) {
    await placeholder.edit(categoryMatchingRole.toString())
    return
  }

  if (
    categoryChannel?.name?.toLowerCase()?.endsWith("general") === true &&
    containingChannel?.name?.toLowerCase()?.endsWith("main") === true
  ) {
    await placeholder.edit(server.roles.everyone.toString())
  }

  if (
    categoryChannel?.name?.toLowerCase()?.endsWith("general") === true &&
    containingChannel?.name?.toLowerCase()?.endsWith("bifrost") === true
  ) {
    // The everyone role does not work the way other roles work; in particular,
    // it does _not_ add everyone to the thread. Instead, it just sits there,
    // looking pretty.
    await placeholder.edit(server.roles.everyone.toString())
  }

  // If we hit this spot, be a monster and delete the useless placeholder and
  // pray for our soul. Placeholder code as we figure out the best way to
  // handle the General category.
  await placeholder.delete()
}

const eventHandlers: DiscordEventHandlers = {
  threadCreate: autoJoinThread,
}

export default eventHandlers
