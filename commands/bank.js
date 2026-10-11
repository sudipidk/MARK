const { SlashCommandBuilder } = require("discord.js");
const { executeBank, executeBankHistory } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("bank")
        .setDescription("View bank balances or your private bank history.")
        .addSubcommand(subcommand => subcommand
            .setName("summary")
            .setDescription("View your or another member's public bank summary.")
            .addUserOption(option => option
                .setName("user")
                .setDescription("Member whose public bank summary to view")))
        .addSubcommand(subcommand => subcommand
            .setName("history")
            .setDescription("View your private bank transaction history.")
            .addIntegerOption(option => option
                .setName("page")
                .setDescription("History page")
                .setMinValue(1))),
    async execute(interaction) {
        if (interaction.options.getSubcommand() === "history") {
            return executeBankHistory(interaction);
        }
        return executeBank(interaction);
    }
};
