const { SlashCommandBuilder } = require("discord.js");
const { executeLottery } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("lottery")
        .setDescription("Pick a number for an immediate global-wallet lottery bet.")
        .addIntegerOption(option => option
            .setName("number")
            .setDescription("Pick a number from 1 to 10")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true))
        .addStringOption(option => option
            .setName("amount")
            .setDescription("Wager (for example: 1000, 1k, 1.5m)")
            .setRequired(true)),
    execute: executeLottery
};
