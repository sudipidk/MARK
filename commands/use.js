const { SlashCommandBuilder } = require("discord.js");
const { executeUse } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("use")
        .setDescription("Activate an item from your inventory.")
        .addStringOption(option => option.setName("item").setDescription("Consumable name or catalog ID").setRequired(true))
        .addIntegerOption(option => option.setName("quantity").setDescription("Number of items (default 1)").setMinValue(1).setMaxValue(100)),
    execute: executeUse
};
