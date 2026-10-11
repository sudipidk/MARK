const { SlashCommandBuilder } = require("discord.js");
const { executeRichest } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("richest")
        .setDescription("Show the global richest players.")
        .addStringOption(option => option
            .setName("mode")
            .setDescription("Balance metric to rank by")
            .addChoices(
                { name: "Combined wealth (default)", value: "combined" },
                { name: "Wallet", value: "wallet" },
                { name: "Bank", value: "bank" }
            )),
    execute: executeRichest
};
