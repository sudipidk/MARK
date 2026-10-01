const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { updateServerData } = require("../services/counting");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("counting-math")
        .setDescription("Allow or disallow math expressions in the counting channel.")
        .addStringOption(option => option
            .setName("enabled")
            .setDescription("Whether math expressions are enabled.")
            .addChoices(
                { name: "yes", value: "yes" },
                { name: "no", value: "no" }
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

        const enabled = interaction.options.getString("enabled", true) === "yes";
        updateServerData(interaction.guildId, data => {
            data.mathEnabled = enabled;
        });

        await interaction.reply({
            content: `Math expressions are now ${enabled ? "enabled" : "disabled"}.`
        });
    }
};
