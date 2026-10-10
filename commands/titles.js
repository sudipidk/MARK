const { SlashCommandBuilder } = require("discord.js");
const { executeTitles } = require("../services/economy-commands");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("titles")
        .setDescription("List and equip your owned titles.")
        .addSubcommand(command => command
            .setName("list")
            .setDescription("List your titles.")
            .addIntegerOption(option => option.setName("page").setDescription("Page number").setMinValue(1).setMaxValue(1001)))
        .addSubcommand(command => command
            .setName("use")
            .setDescription("Equip an owned title.")
            .addStringOption(option => option.setName("title").setDescription("Title name or Variant code").setRequired(true))),
    execute: executeTitles
};
