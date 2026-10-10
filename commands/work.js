const { SlashCommandBuilder } = require("discord.js");
const { executeReward } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder().setName("work").setDescription("Work for coins."),
    execute: interaction => executeReward(interaction, "work")
};
