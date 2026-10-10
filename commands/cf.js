const { SlashCommandBuilder } = require("discord.js");
const { executeCoinflip } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("cf")
        .setDescription("Bet coins on a coinflip.")
        .addIntegerOption(option => option
            .setName("amount")
            .setDescription("Stake from 100 to 100,000 coins")
            .setMinValue(100)
            .setMaxValue(100000)
            .setRequired(true)),
    execute: executeCoinflip
};
