const { SlashCommandBuilder } = require("discord.js");
const { executeDeposit } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("deposit")
        .setDescription("Deposit wallet coins into a 12-hour bank lot.")
        .addStringOption(option => option
            .setName("amount")
            .setDescription("Principal to deposit (for example: 1000, 1k, 1.5m)")
            .setRequired(true))
        .addStringOption(option => option
            .setName("confirm")
            .setDescription("Confirmation token shown with the fee preview")),
    execute: executeDeposit
};
