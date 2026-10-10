const { SlashCommandBuilder } = require("discord.js");
const { executeShop } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("shop")
        .setDescription("Browse the shop, buy an item, or sell an unused item.")
        .addSubcommand(command => command.setName("all").setDescription("Browse all shop categories."))
        .addSubcommand(command => command.setName("titles").setDescription("Browse available titles."))
        .addSubcommand(command => command.setName("consumables").setDescription("Browse boosts and bodyguards."))
        .addSubcommand(command => command
            .setName("buy")
            .setDescription("Buy an item.")
            .addStringOption(option => option.setName("item").setDescription("Item name or catalog ID").setRequired(true))
            .addIntegerOption(option => option.setName("quantity").setDescription("Quantity (default 1)").setMinValue(1).setMaxValue(100)))
        .addSubcommand(command => command
            .setName("sell")
            .setDescription("Sell an eligible unused item.")
            .addStringOption(option => option.setName("item").setDescription("Item name or catalog ID").setRequired(true))
            .addIntegerOption(option => option.setName("quantity").setDescription("Quantity (default 1)").setMinValue(1).setMaxValue(100))),
    execute: executeShop
};
