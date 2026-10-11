const { SlashCommandBuilder } = require("discord.js");
const { executeAdminWalletChange } = require("../services/economy-commands");

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName("removemoney")
        .setDescription("Admin only: remove coins from a user's global wallet.")
        .addUserOption(option => option.setName("user").setDescription("Target user").setRequired(true))
        .addStringOption(option => option
            .setName("amount")
            .setDescription("Amount to remove (for example: 1000, 1k, 1.5m)")
            .setRequired(true)),
    execute: interaction => executeAdminWalletChange(interaction, "remove")
};
