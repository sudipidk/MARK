const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { createEmbed } = require("../services/embeds");
const { UserFacingError } = require("../services/errors");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("timeoutes")
        .setDescription("List members with an active timeout.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(interaction) {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ModerateMembers)) {
            throw new UserFacingError("You need the Moderate Members permission to view active timeouts.");
        }

        const members = await interaction.guild.members.fetch();
        const timedOut = [...members.values()]
            .filter(member => member.communicationDisabledUntilTimestamp > Date.now())
            .sort((left, right) =>
                left.communicationDisabledUntilTimestamp - right.communicationDisabledUntilTimestamp);
        const visibleMembers = timedOut.slice(0, 20);
        const description = visibleMembers.length
            ? visibleMembers.map((member, index) =>
                `**${index + 1}.** ${member.user.tag || member.user.username} (<@${member.id}>)\nEnds <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`
            ).join("\n\n")
            : "There are no active timeouts.";
        const embed = createEmbed(`Active timeouts (${timedOut.length})`)
            .setDescription(description);
        if (timedOut.length > visibleMembers.length) {
            embed.setFooter({ text: `Showing first ${visibleMembers.length} of ${timedOut.length}.` });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
};
