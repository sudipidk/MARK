const { SlashCommandBuilder } = require("discord.js");
const { executeCooldowns } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder().setName("cooldown").setDescription("Check your economy action cooldowns."),
    execute: executeCooldowns
};
