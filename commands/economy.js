const { SlashCommandBuilder } = require("discord.js");
const { executeEconomyStats } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder().setName("economy").setDescription("Show global economy statistics."),
    execute: executeEconomyStats
};
