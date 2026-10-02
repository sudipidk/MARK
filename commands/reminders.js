const { SlashCommandBuilder } = require("discord.js");
const { listPendingReminders } = require("../services/reminder-storage");
const { createReminderListPayload } = require("../services/reminder-list");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("reminders")
        .setDescription("List your active reminders."),

    async execute(interaction) {
        const reminders = await listPendingReminders(interaction.user.id);
        await interaction.reply({
            ...createReminderListPayload(interaction.user.id, reminders),
            ephemeral: true
        });
    }
};
