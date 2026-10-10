const { SlashCommandBuilder } = require("discord.js");
const { executeSteal } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("steal")
        .setDescription("Attempt to steal coins from another member.")
        .addUserOption(option => option.setName("user").setDescription("Target member").setRequired(true)),
    execute: executeSteal
};
