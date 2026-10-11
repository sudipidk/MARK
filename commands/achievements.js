const { SlashCommandBuilder } = require("discord.js");
const { executeAchievements } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("achievements")
        .setDescription("View achievement requirements, progress, and rewards.")
        .addUserOption(option => option
            .setName("user")
            .setDescription("Member whose public achievements to view"))
        .addIntegerOption(option => option
            .setName("page")
            .setDescription("Achievement catalog page")
            .setMinValue(1)),
    execute: executeAchievements
};
