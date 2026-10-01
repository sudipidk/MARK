const {
    ChannelType,
    SlashCommandBuilder
} = require("discord.js");
const { createEmbed } = require("../services/embeds");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("serverinfo")
        .setDescription("Show useful information about this server."),

    async execute(interaction) {
        const guild = interaction.guild;
        const owner = await guild.fetchOwner();
        const cachedMembers = [...guild.members.cache.values()];
        const humans = cachedMembers.filter(member => !member.user.bot).length;
        const bots = cachedMembers.length - humans;
        const memberLabel = guild.members.cache.size >= guild.memberCount
            ? `Humans: **${humans}** · Bots: **${bots}**`
            : `Cached humans: **${humans}** · Cached bots: **${bots}**`;
        const channels = [...guild.channels.cache.values()];
        const regularText = channels.filter(channel => channel.type === ChannelType.GuildText).length;
        const announcement = channels.filter(channel => channel.type === ChannelType.GuildAnnouncement).length;
        const voice = channels.filter(channel =>
            channel.type === ChannelType.GuildVoice ||
            channel.type === ChannelType.GuildStageVoice).length;
        const forums = channels.filter(channel =>
            channel.type === ChannelType.GuildForum ||
            channel.type === ChannelType.GuildMedia).length;
        const verificationNames = ["None", "Low", "Medium", "High", "Very high"];
        const verification = verificationNames[guild.verificationLevel] ||
            String(guild.verificationLevel);

        const embed = createEmbed("Server information")
            .addFields(
                { name: "Server", value: guild.name, inline: true },
                { name: "Server ID", value: guild.id, inline: true },
                { name: "Owner", value: `${owner.user} (${owner.id})`, inline: true },
                { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: true },
                { name: "Members", value: `**${guild.memberCount}**\n${memberLabel}`, inline: true },
                { name: "Channels", value: `Total: **${channels.length}**\nText: **${regularText}** · Announcement: **${announcement}**\nVoice/stage: **${voice}** · Forum/media: **${forums}**`, inline: true },
                { name: "Roles", value: String(guild.roles.cache.size), inline: true },
                { name: "Emojis", value: String(guild.emojis.cache.size), inline: true },
                { name: "Stickers", value: String(guild.stickers.cache.size), inline: true },
                { name: "Boosts", value: `Level **${guild.premiumTier}** · **${guild.premiumSubscriptionCount ?? 0}** boosts`, inline: true },
                { name: "Verification", value: verification, inline: true }
            );
        const iconUrl = guild.iconURL({ size: 1024 });
        if (iconUrl) embed.setThumbnail(iconUrl);

        await interaction.reply({ embeds: [embed] });
    }
};
