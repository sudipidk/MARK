const { SlashCommandBuilder } = require("discord.js");
const { executeReset } = require("../services/economy-commands");

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName("reset")
        .setDescription("Admin only: reset a global wallet to 1,000 coins after confirmation.")
        .addUserOption(option => option.setName("user").setDescription("Target user").setRequired(true))
        .addStringOption(option => option
            .setName("confirm")
            .setDescription("Confirmation token from the reset preview")),
    execute: executeReset
};
