const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { updateServerData } = require("../services/counting");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("counting-reset")
        .setDescription("Reset this server's count and counting statistics.")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({
                content: "Only server administrators can reset counting.",
                ephemeral: true
            });
            return;
        }

        await updateServerData(interaction.guildId, data => {
            data.currentCount = 0;
            data.highestCount = 0;
            data.lastUserId = null;
            data.countedMessageIds = [];
            data.countedMessages = {};
            data.countsByUser = {};
            data.deletedByUser = {};
        });

        await interaction.reply({
            content: "The count and all counting statistics have been reset."
        });
    }
};
