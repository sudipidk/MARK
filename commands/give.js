const { SlashCommandBuilder } = require("discord.js");
const { executeGive } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("give")
        .setDescription("Transfer coins to a server member.")
        .addUserOption(option => option.setName("user").setDescription("Recipient").setRequired(true))
        .addIntegerOption(option => option.setName("amount").setDescription("Whole coins to transfer").setMinValue(1).setRequired(true)),
    execute: executeGive
};
