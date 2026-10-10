const { SlashCommandBuilder } = require("discord.js");
const { executeReward } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder().setName("weekly").setDescription("Claim your weekly coin reward."),
    execute: interaction => executeReward(interaction, "weekly")
};
