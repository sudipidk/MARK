const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { executeModeration } = require("../services/moderation");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ban")
        .setDescription("Ban a user from this server.")
        .addUserOption(option => option
            .setName("user")
            .setDescription("The user to ban.")
            .setRequired(true))
        .addStringOption(option => option
            .setName("reason")
            .setDescription("Why the user is being banned.")
            .setMaxLength(500))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        const embed = await executeModeration(interaction, {
            action: "ban",
            user: interaction.options.getUser("user", true),
            reason: interaction.options.getString("reason")
        });
        await interaction.reply({ embeds: [embed] });
    }
};
