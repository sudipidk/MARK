const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { updateServerData } = require("../services/counting");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("counting-streak")
        .setDescription("Choose whether members may count twice in a row.")
        .addStringOption(option => option
            .setName("mode")
            .setDescription("Turn consecutive-count protection on or off.")
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
        await updateServerData(interaction.guildId, data => {
            data.streakEnabled = enabled;
        });

        await interaction.reply({
            content: `Counting streak protection is now ${enabled ? "on" : "off"}.`
        });
    }
};
