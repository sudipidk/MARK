const { SlashCommandBuilder } = require("discord.js");
const { executeResetAll } = require("../services/economy-commands");

module.exports = {
    adminOnly: true,
    data: new SlashCommandBuilder()
        .setName("resetall")
        .setDescription("Admin only: confirm a reset of every global economy wallet.")
        .addStringOption(option => option
            .setName("confirm")
            .setDescription("Global confirmation token from the reset preview")),
    execute: executeResetAll
};
