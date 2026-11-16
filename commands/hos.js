const {
    ChannelType,
    PermissionFlagsBits,
    SlashCommandBuilder
} = require("discord.js");
const { MAX_REACTION_COUNT, executeHallCommand } = require("../services/hall-of-fame");

function addHallOptions(command) {
    return command
        .addSubcommand(subcommand => subcommand
            .setName("setemoji")
            .setDescription("Set the Hall of Shame reaction emoji.")
            .addStringOption(option => option
                .setName("emoji")
                .setDescription("One Unicode emoji or custom server emoji.")
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName("setchannel")
            .setDescription("Set where Hall of Shame messages will be posted.")
            .addChannelOption(option => option
                .setName("channel")
                .setDescription("Text or announcement channel.")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName("setnum")
            .setDescription("Set the reaction count required for the Hall of Shame.")
            .addIntegerOption(option => option
                .setName("num")
                .setDescription(`Required reactions (1-${MAX_REACTION_COUNT}).`)
                .setMinValue(1)
                .setMaxValue(MAX_REACTION_COUNT)
                .setRequired(true)));
}

module.exports = {
    data: addHallOptions(new SlashCommandBuilder()
        .setName("hos")
        .setDescription("Configure the Hall of Shame.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild | PermissionFlagsBits.Administrator)),
    execute(interaction) {
        return executeHallCommand(interaction, "hos");
    }
};
