const { ChannelType, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { updateServerData } = require("../services/counting");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("counting-channel")
        .setDescription("Set the counting channel for this server.")
        .addChannelOption(option => option
            .setName("channel")
            .setDescription("The channel where members will count.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({
                content: "Only server administrators can configure counting.",
                ephemeral: true
            });
            return;
        }

        const channel = interaction.options.getChannel("channel", true);
        updateServerData(interaction.guildId, data => {
            data.channelId = channel.id;
        });

        await interaction.reply({
            content: `Counting is now enabled in ${channel}. Your count and stats were kept.`
        });
    }
};
