const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { updateServerData } = require("../services/counting");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("counting-cheat")
        .setDescription("Choose whether incorrect counts are deleted without resetting the count.")
        .addStringOption(option => option
            .setName("mode")
            .setDescription("Turn counting cheat mode on or off.")
            .addChoices(
                { name: "on", value: "on" },
                { name: "off", value: "off" }
            )
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

        const enabled = interaction.options.getString("mode", true) === "on";
        updateServerData(interaction.guildId, data => {
            data.cheatEnabled = enabled;
        });

        await interaction.reply({
            content: `Counting cheat mode is now ${enabled ? "on" : "off"}.`
        });
    }
};
