const {
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder
} = require("discord.js");
const { createEmbed } = require("../services/embeds");
const {
    getGuildSettings,
    setModerationLogChannel,
    disableModerationLog
} = require("../services/guild-settings");
const { UserFacingError } = require("../services/errors");

function requireManageGuild(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
        !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        throw new UserFacingError("You need Administrator or Manage Server permission to configure moderation logs.");
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("modlog")
        .setDescription("Configure the moderation log channel.")
        .addSubcommand(subcommand => subcommand
            .setName("setchannel")
            .setDescription("Set the moderation log channel.")
            .addChannelOption(option => option
                .setName("channel")
                .setDescription("Channel where moderation actions will be logged.")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName("disable")
            .setDescription("Disable moderation logs."))
        .addSubcommand(subcommand => subcommand
            .setName("config")
            .setDescription("Show the moderation log configuration.")),

    async execute(interaction) {
        requireManageGuild(interaction);
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === "setchannel") {
            const channel = interaction.options.getChannel("channel", true);
            setModerationLogChannel(interaction.guildId, channel.id);
            await interaction.reply({ content: `Moderation logs will be sent to ${channel}.` });
            return;
        }

        if (subcommand === "disable") {
            disableModerationLog(interaction.guildId);
            await interaction.reply({ content: "Moderation logs have been disabled." });
            return;
        }

        const settings = getGuildSettings(interaction.guildId);
        await interaction.reply({
            embeds: [createEmbed("Moderation log configuration")
                .addFields({
                    name: "Channel",
                    value: settings.moderationLogChannelId
                        ? `<#${settings.moderationLogChannelId}>`
                        : "Disabled"
                })]
        });
    }
};
