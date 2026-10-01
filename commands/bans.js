const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { createEmbed } = require("../services/embeds");
const { UserFacingError } = require("../services/errors");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("bans")
        .setDescription("List this server's bans.")
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
            throw new UserFacingError("You need the Ban Members permission to view server bans.");
        }

        const bans = await interaction.guild.bans.fetch();
        const items = [...bans.values()].slice(0, 10);
        const description = items.length
            ? items.map((ban, index) =>
                `**${index + 1}.** ${ban.user.tag || ban.user.username} (\`${ban.user.id}\`)\nReason: ${(ban.reason || "No reason provided").slice(0, 120)}`
            ).join("\n\n")
            : "There are no banned users.";
        const embed = createEmbed(`Server bans (${bans.size})`)
            .setDescription(description);
        if (bans.size > items.length) {
            embed.setFooter({ text: `Showing first ${items.length} of ${bans.size}.` });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
