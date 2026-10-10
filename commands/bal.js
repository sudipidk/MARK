const { SlashCommandBuilder } = require("discord.js");
const { executeBalance } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("bal")
        .setDescription("Show a player's global economy wallet balance and equipped title.")
        .addUserOption(option => option.setName("user").setDescription("Member to check")),
    execute: executeBalance
};
