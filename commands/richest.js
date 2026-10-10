const { SlashCommandBuilder } = require("discord.js");
const { executeRichest } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder().setName("richest").setDescription("Show the global top ten wallets."),
    execute: executeRichest
};
