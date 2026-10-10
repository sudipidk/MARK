const { SlashCommandBuilder } = require("discord.js");
const { executeProfile } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("profile")
        .setDescription("Show a player's public global economy profile.")
        .addUserOption(option => option.setName("user").setDescription("Member to view")),
    execute: executeProfile
};
