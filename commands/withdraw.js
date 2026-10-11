const { SlashCommandBuilder } = require("discord.js");
const { executeWithdraw } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("withdraw")
        .setDescription("Withdraw unlocked bank principal to your wallet.")
        .addStringOption(option => option
            .setName("amount")
            .setDescription("Principal to withdraw (for example: 1000, 1k, 1.5m)")
            .setRequired(true)),
    execute: executeWithdraw
};
