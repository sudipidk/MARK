const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { executeModeration } = require("../services/moderation");
const { UserFacingError } = require("../services/errors");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("unban")
        .setDescription("Remove a user's ban from this server.")
        .addStringOption(option => option
            .setName("user")
            .setDescription("The banned user's ID or mention.")
            .setMaxLength(30)
            .setRequired(true))
        .addStringOption(option => option
            .setName("reason")
            .setDescription("Why the user is being unbanned.")
            .setMaxLength(500))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        const userInput = interaction.options.getString("user", true).trim();
        const userId = userInput.match(/^(?:<@!?(\d{1,20})>|(\d{1,20}))$/)?.slice(1).find(Boolean);
        if (!userId) {
            throw new UserFacingError("Enter a valid user ID or user mention to unban.");
        }

        const embed = await executeModeration(interaction, {
            action: "unban",
            user: userId,
            reason: interaction.options.getString("reason")
        });
        await interaction.reply({ embeds: [embed] });
    }
};
