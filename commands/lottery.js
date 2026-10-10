const { SlashCommandBuilder } = require("discord.js");
const { executeLottery } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder().setName("lottery").setDescription("Buy a ticket in today's server lottery."),
    execute: executeLottery
};
