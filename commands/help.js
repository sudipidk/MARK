const { SlashCommandBuilder } = require("discord.js");
const { executeHelp } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Browse public MARK commands by category.")
        .addIntegerOption(option => option
            .setName("page")
            .setDescription("Help page")
            .setMinValue(1)),
    execute: executeHelp
};
