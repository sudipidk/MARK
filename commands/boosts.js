const { SlashCommandBuilder } = require("discord.js");
const { executeBoosts } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder().setName("boosts").setDescription("Show your active economy effects."),
    execute: executeBoosts
};
