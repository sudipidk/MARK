const { SlashCommandBuilder } = require("discord.js");
const { executeGive } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("give")
        .setDescription("Transfer coins to a server member.")
        .addUserOption(option => option.setName("user").setDescription("Recipient").setRequired(true))
        .addStringOption(option => option.setName("amount").setDescription("Amount (for example: 1000, 1k, 1.5m)").setRequired(true)),
    execute: executeGive
};
