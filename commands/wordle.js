const { ChannelType, SlashCommandBuilder } = require("discord.js");
const { executeWordleCommand } = require("../services/wordle");

function addCreateOptions(subcommand, description) {
    return subcommand
        .setDescription(description)
        .addStringOption(option => option
            .setName("word")
            .setDescription("Secret dictionary answer (1 to 15 letters).")
            .setMinLength(1)
            .setMaxLength(15)
            .setRequired(true))
        .addIntegerOption(option => option
            .setName("reward")
            .setDescription("MARK prize for the winner.")
            .setMinValue(1)
            .setMaxValue(2_147_483_647)
            .setRequired(true))
        .addStringOption(option => option
            .setName("title")
            .setDescription("Optional challenge title.")
            .setMaxLength(100))
        .addIntegerOption(option => option
            .setName("attempts")
            .setDescription("Maximum guesses per player (defaults to 6).")
            .setMinValue(1)
            .setMaxValue(20));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("wordle")
        .setDescription("Play and administer MARK's persistent server Wordle.")
        .addSubcommand(subcommand => addCreateOptions(subcommand, "Create a custom Wordle challenge.").setName("create"))
        .addSubcommand(subcommand => addCreateOptions(subcommand, "Add a custom challenge to the queue.").setName("queue-add"))
        .addSubcommand(subcommand => subcommand
            .setName("queue")
            .setDescription("View the active challenge and pending queue."))
        .addSubcommand(subcommand => subcommand
            .setName("queue-remove")
            .setDescription("Remove a pending challenge by ID.")
            .addStringOption(option => option.setName("id").setDescription("Challenge ID").setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName("queue-move")
            .setDescription("Move a pending challenge to another position.")
            .addStringOption(option => option.setName("id").setDescription("Challenge ID").setRequired(true))
            .addIntegerOption(option => option.setName("position").setDescription("New queue position").setMinValue(1).setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName("queue-edit")
            .setDescription("Edit a pending custom challenge.")
            .addStringOption(option => option.setName("id").setDescription("Challenge ID").setRequired(true))
            .addStringOption(option => option.setName("word").setDescription("New secret dictionary answer.").setMinLength(1).setMaxLength(15))
            .addStringOption(option => option.setName("title").setDescription("New challenge title.").setMaxLength(100))
            .addIntegerOption(option => option.setName("reward").setDescription("New MARK reward.").setMinValue(1).setMaxValue(2_147_483_647)))
        .addSubcommand(subcommand => subcommand
            .setName("queue-clear")
            .setDescription("Remove all pending challenges without affecting the active one."))
        .addSubcommand(subcommand => subcommand
            .setName("active")
            .setDescription("View the current challenge's public details."))
        .addSubcommand(subcommand => subcommand
            .setName("skip")
            .setDescription("Skip the active challenge and reveal its answer."))
        .addSubcommand(subcommand => subcommand
            .setName("end")
            .setDescription("End the active challenge without awarding a prize."))
        .addSubcommand(subcommand => subcommand
            .setName("reveal")
            .setDescription("Privately reveal the active answer to an authorized admin."))
        .addSubcommand(subcommand => subcommand
            .setName("set-channel")
            .setDescription("Set the dedicated Wordle announcements channel.")
            .addChannelOption(option => option
                .setName("channel")
                .setDescription("Text or announcement channel.")
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName("settings")
            .setDescription("Admin only: update automatic challenge settings.")
            .addBooleanOption(option => option.setName("automatic-enabled").setDescription("Whether automatic challenges run when the queue is empty."))
            .addIntegerOption(option => option.setName("reward-5").setDescription("Automatic 5-letter reward (minimum 5,000).").setMinValue(5000).setMaxValue(2_147_483_647))
            .addIntegerOption(option => option.setName("reward-6").setDescription("Automatic 6-letter reward (minimum 5,000).").setMinValue(5000).setMaxValue(2_147_483_647))
            .addIntegerOption(option => option.setName("reward-7").setDescription("Automatic 7-letter reward (minimum 5,000).").setMinValue(5000).setMaxValue(2_147_483_647))
            .addIntegerOption(option => option.setName("default-attempts").setDescription("Default attempts per player.").setMinValue(1).setMaxValue(20))
            .addIntegerOption(option => option.setName("maximum-custom-word-length").setDescription("Maximum custom answer length.").setMinValue(1).setMaxValue(15))
            .addIntegerOption(option => option.setName("five-percent").setDescription("Automatic 5-letter challenge percentage.").setMinValue(0).setMaxValue(100))
            .addIntegerOption(option => option.setName("six-percent").setDescription("Automatic 6-letter challenge percentage.").setMinValue(0).setMaxValue(100)))
        .addSubcommand(subcommand => subcommand
            .setName("stats")
            .setDescription("View your personal Wordle statistics."))
        .addSubcommand(subcommand => subcommand
            .setName("leaderboard")
            .setDescription("View this server's Wordle leaderboard.")
            .addStringOption(option => option
                .setName("category")
                .setDescription("Leaderboard category.")
                .addChoices(
                    { name: "Most victories", value: "wins" },
                    { name: "Most MARK earned", value: "earnings" },
                    { name: "Best winning streak", value: "streak" },
                    { name: "Lowest average attempts", value: "average" }
                )))
        .addSubcommand(subcommand => subcommand
            .setName("history")
            .setDescription("View recent completed Wordle challenges."))
        .addSubcommandGroup(group => group
            .setName("admin")
            .setDescription("Wordle owner/admin controls.")
            .addSubcommand(subcommand => subcommand
                .setName("user")
                .setDescription("Server owner only: toggle Wordle admin access.")
                .addUserOption(option => option.setName("user").setDescription("User to toggle").setRequired(true)))
            .addSubcommand(subcommand => subcommand
                .setName("stats")
                .setDescription("View server-wide Wordle statistics."))),
    execute: executeWordleCommand
};
