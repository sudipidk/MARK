const { SlashCommandBuilder } = require("discord.js");
const { executeTransactions } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("transactions")
        .setDescription("View your private transaction history.")
        .addIntegerOption(option => option.setName("page").setDescription("Page number").setMinValue(1).setMaxValue(1001)),
    execute: executeTransactions
};
