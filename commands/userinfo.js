const { SlashCommandBuilder } = require("discord.js");
const { createEmbed } = require("../services/embeds");

function truncate(text, maxLength) {
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("userinfo")
        .setDescription("Show useful public information about a user.")
        .addUserOption(option => option
            .setName("user")
            .setDescription("The user to look up; defaults to you.")),

    async execute(interaction) {
        const user = interaction.options.getUser("user") || interaction.user;
        let member = interaction.guild.members.cache.get(user.id) || null;
        if (!member) {
            try {
                member = await interaction.guild.members.fetch(user.id);
            } catch (error) {
                if (error.code !== 10007) throw error;
            }
        }

        const roles = member
            ? member.roles.cache
                .filter(role => role.id !== interaction.guild.id)
                .sort((left, right) => right.position - left.position)
                .map(role => role.toString())
            : [];
        const roleText = roles.length
            ? truncate(roles.slice(0, 15).join(", ") +
                (roles.length > 15 ? `, and ${roles.length - 15} more` : ""), 1024)
            : "No server roles";
        const avatar = user.displayAvatarURL({ size: 1024 });
        const embed = createEmbed("User information")
            .setThumbnail(avatar)
            .addFields(
                { name: "Username", value: truncate(user.tag || user.username, 256), inline: true },
                { name: "Display name", value: truncate(member?.displayName || user.globalName || user.username, 256), inline: true },
                { name: "User ID", value: user.id, inline: true },
                { name: "Account created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: true },
                { name: "Server joined", value: member?.joinedTimestamp
                    ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
                    : "Not a current server member", inline: true },
                { name: "Account type", value: user.bot ? "Bot" : "User", inline: true },
                { name: "Highest role", value: member?.roles.highest.toString() || "Not in this server", inline: true },
                { name: `Roles (${roles.length})`, value: roleText }
            );

        await interaction.reply({ embeds: [embed] });
    }
};
