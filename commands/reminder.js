const { SlashCommandBuilder } = require("discord.js");
const { cancelReminder } = require("../services/reminder-storage");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("reminder")
        .setDescription("Manage your reminders.")
        .addSubcommand(subcommand => subcommand
            .setName("cancel")
            .setDescription("Cancel one of your active reminders.")
            .addStringOption(option => option
                .setName("id")
                .setDescription("The reminder ID shown when it was created or in /reminders.")
                .setMaxLength(36)
                .setRequired(true))),

    async execute(interaction) {
        const reminder = await cancelReminder(
            interaction.user.id,
            interaction.options.getString("id", true)
        );
        await interaction.reply({
            content: `Reminder \`${reminder._id}\` cancelled.`,
            ephemeral: true
        });
    }
};
