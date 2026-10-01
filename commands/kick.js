const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { executeModeration } = require("../services/moderation");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("kick")
        .setDescription("Kick a member from this server.")
        .addUserOption(option => option
            .setName("user")
            .setDescription("The member to kick.")
            .setRequired(true))
        .addStringOption(option => option
            .setName("reason")
            .setDescription("Why the member is being kicked.")
            .setMaxLength(500))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

    async execute(interaction) {
        const embed = await executeModeration(interaction, {
            action: "kick",
            user: interaction.options.getUser("user", true),
            reason: interaction.options.getString("reason")
        });
        await interaction.reply({ embeds: [embed] });
    }
};
