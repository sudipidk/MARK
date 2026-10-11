const { SlashCommandBuilder } = require("discord.js");
const { executeBankFunds } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("bankfunds")
        .setDescription("Show the locked and unlocked funds in your bank."),
    execute: executeBankFunds
};
