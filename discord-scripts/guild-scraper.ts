import { Client, TextChannel, OverwriteType } from "discord.js"
import { Robot } from "hubot"

export default async function guildScraper(discordClient: Client, robot: Robot): Promise<void> {
    const { application } = discordClient
  
    if (application) {
        robot.logger.info("Guild scraper loaded this info from connected guild")
        
        discordClient.guilds.cache.forEach(async (guild) => {
            try {
                const roles = await guild.roles.fetch()

                roles.forEach((role) => {
                    robot.logger.info(`Role: ${role.name}`)
                    robot.logger.info("Permissions:")
                    role.permissions.toArray().forEach((permission) => {
                        robot.logger.info(permission)
                    })
                })
                
            } catch (error) {
                robot.logger.error(`Error while scrapping roles in guild ${guild.id}:`, error)
            }
        })

        discordClient.channels.cache.forEach((channel) => {
            if (channel instanceof TextChannel) {
                robot.logger.info(`Channel name: ${channel.name}`)
    
                const rolePermissions: string[] = []

                channel.permissionOverwrites.cache.forEach((overwrite) => {
                    if (overwrite.type === OverwriteType.Role) {
                        const role = channel.guild.roles.cache.get(overwrite.id)
                        if (role) {
                            rolePermissions.push(role.name)
                        }
                    }
                })
    
                robot.logger.info(`Assigned roles: ${rolePermissions.join(', ')}`)
            }
        })
    }
}
