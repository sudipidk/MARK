const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { executeModeration } = require("../services/moderation");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("untimeout")
        .setDescription("Remove a member's active timeout.")
        .addUserOption(option => option
            .setName("user")
            .setDescription("The member whose timeout should be removed.")
            .setRequired(true))
        .addStringOption(option => option
            .setName("reason")
            .setDescription("Why the timeout is being removed.")
            .setMaxLength(500))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        const embed = await executeModeration(interaction, {
            action: "untimeout",
            user: interaction.options.getUser("user", true),
            reason: interaction.options.getString("reason")
        });
        await interaction.reply({ embeds: [embed] });
    }
};
