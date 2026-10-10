const { SlashCommandBuilder } = require("discord.js");
const { executeRichest } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder().setName("richest").setDescription("Show the server's top ten wallets."),
    execute: executeRichest
};
