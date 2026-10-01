const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { parseDuration } = require("../services/duration");
const { UserFacingError } = require("../services/errors");
const { executeModeration } = require("../services/moderation");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("timeout")
        .setDescription("Temporarily prevent a member from communicating.")
        .addUserOption(option => option
            .setName("user")
            .setDescription("The member to time out.")
            .setRequired(true))
        .addStringOption(option => option
            .setName("duration")
            .setDescription("Duration such as 30s, 5m, 1h, 1d, or 7d.")
            .setRequired(true)
            .setMaxLength(20))
        .addStringOption(option => option
            .setName("reason")
            .setDescription("Why the member is being timed out.")
            .setMaxLength(500))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        const rawDuration = interaction.options.getString("duration", true);
        const durationMs = parseDuration(rawDuration);
        if (!durationMs) {
            throw new UserFacingError("Invalid duration. Use values such as 30s, 5m, 1h, 1d, or 7d (maximum 28d).");
        }

        const embed = await executeModeration(interaction, {
            action: "timeout",
            user: interaction.options.getUser("user", true),
            durationMs,
            reason: interaction.options.getString("reason")
        });
        await interaction.reply({ embeds: [embed] });
    }
};
