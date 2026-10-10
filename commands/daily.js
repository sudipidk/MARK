const { SlashCommandBuilder } = require("discord.js");
const { executeReward } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder().setName("daily").setDescription("Claim your daily coin reward."),
    execute: interaction => executeReward(interaction, "daily")
};
