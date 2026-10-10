const { SlashCommandBuilder } = require("discord.js");
const { executeInventory } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("inventory")
        .setDescription("View owned titles, items, and active effects.")
        .addUserOption(option => option.setName("user").setDescription("Member to view"))
        .addIntegerOption(option => option.setName("page").setDescription("Page number").setMinValue(1).setMaxValue(1001)),
    execute: executeInventory
};
