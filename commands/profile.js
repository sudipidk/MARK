const { SlashCommandBuilder } = require("discord.js");
const { executeProfile } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("profile")
        .setDescription("Show public economy stats.")
        .addUserOption(option => option.setName("user").setDescription("Member to view")),
    execute: executeProfile
};
