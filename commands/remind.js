const { SlashCommandBuilder } = require("discord.js");
const { createReminder } = require("../services/reminder-storage");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("remind")
        .setDescription("Ask MARK to send you a reminder by DM.")
        .addStringOption(option => option
            .setName("duration")
            .setDescription("Examples: 10s, 5m, 2h, 1d, 1w, 1h30m.")
            .setMaxLength(30)
            .setRequired(true))
        .addStringOption(option => option
            .setName("message")
            .setDescription("What should MARK remind you about?")
            .setMaxLength(1000)
            .setRequired(true)),

    async execute(interaction) {
        const reminder = await createReminder(
            interaction.user.id,
            interaction.options.getString("duration", true),
            interaction.options.getString("message", true)
        );
        await interaction.reply({
            content: `I’ll remind you by DM <t:${Math.floor(reminder.triggerAt.getTime() / 1000)}:R>. Reminder ID: \`${reminder._id}\`.`,
            ephemeral: true
        });
    }
};
