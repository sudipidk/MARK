const { SlashCommandBuilder } = require("discord.js");
const { executeBalance } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("bal")
        .setDescription("Show an economy wallet balance.")
        .addUserOption(option => option.setName("user").setDescription("Member to check")),
    execute: executeBalance
};
