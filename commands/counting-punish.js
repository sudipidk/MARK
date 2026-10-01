const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { updateServerData } = require("../services/counting");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("counting-punish")
        .setDescription("Set the timeout applied for counting violations (0 disables it).")
        .addIntegerOption(option => option
            .setName("minutes")
            .setDescription("Timeout duration in minutes; use 0 to disable punishments.")
            .setMinValue(0)
            .setMaxValue(40320)
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

        const minutes = interaction.options.getInteger("minutes", true);
        updateServerData(interaction.guildId, data => {
            data.punishmentMinutes = minutes;
        });

        await interaction.reply({
            content: minutes === 0
                ? "Counting punishments are disabled."
                : `Counting violations will result in a ${minutes}-minute timeout.`
        });
    }
};
