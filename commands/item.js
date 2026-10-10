const { SlashCommandBuilder } = require("discord.js");
const { executeItem } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("item")
        .setDescription("Inspect a catalog item.")
        .addStringOption(option => option.setName("item").setDescription("Item name or catalog ID").setRequired(true)),
    execute: executeItem
};
