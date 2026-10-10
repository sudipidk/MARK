const { SlashCommandBuilder } = require("discord.js");
const { executeCoinflip } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("cf")
        .setDescription("Bet coins on heads or tails.")
        .addStringOption(option => option
            .setName("choice")
            .setDescription("Choose heads or tails.")
            .addChoices(
                { name: "Heads", value: "heads" },
                { name: "Tails", value: "tails" }
            )
            .setRequired(true))
        .addIntegerOption(option => option
            .setName("amount")
            .setDescription("Wager any positive whole number of coins")
            .setMinValue(1)
            .setRequired(true)),
    execute: executeCoinflip
};
