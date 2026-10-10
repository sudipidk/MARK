const { SlashCommandBuilder } = require("discord.js");
const { executeReward } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder().setName("beg").setDescription("Ask for coins; success is not guaranteed."),
    execute: interaction => executeReward(interaction, "beg")
};
