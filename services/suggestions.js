const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits
} = require("discord.js");
const { readJsonFile, updateJsonFile } = require("./storage");
const { COLORS, createEmbed } = require("./embeds");
const { UserFacingError } = require("./errors");

const FILE_NAME = "suggestions.json";

function defaultGuildData() {
    return {
        enabled: false,
        channelId: null,
        nextId: 1,
        suggestions: {}
    };
}

function readGuildData(guildId) {
    const allData = readJsonFile(FILE_NAME, {});
    const saved = allData[guildId] || {};
    return {
        ...defaultGuildData(),
        ...saved,
        suggestions: { ...(saved.suggestions || {}) }
    };
}

function configureSuggestions(guildId, channelId) {
    return updateJsonFile(FILE_NAME, allData => {
        const data = { ...defaultGuildData(), ...(allData[guildId] || {}) };
        data.enabled = true;
        data.channelId = channelId;
        allData[guildId] = data;
    });
}

function disableSuggestions(guildId) {
    return updateJsonFile(FILE_NAME, allData => {
        const data = { ...defaultGuildData(), ...(allData[guildId] || {}) };
        data.enabled = false;
        allData[guildId] = data;
    });
}

function createSuggestion(guildId, authorId, text) {
    let created;
    updateJsonFile(FILE_NAME, allData => {
        const data = {
            ...defaultGuildData(),
            ...(allData[guildId] || {}),
            suggestions: { ...((allData[guildId] || {}).suggestions || {}) }
        };
        const id = data.nextId;
        data.nextId += 1;
        created = {
            id,
            authorId,
            text,
            createdAt: new Date().toISOString(),
            status: "pending",
            votes: {},
            decision: null,
            channelId: data.channelId,
            messageId: null
        };
        data.suggestions[String(id)] = created;
        allData[guildId] = data;
    });
    return created;
}

function discardSuggestion(guildId, suggestionId) {
    updateJsonFile(FILE_NAME, allData => {
        const data = allData[guildId];
        if (data?.suggestions) delete data.suggestions[String(suggestionId)];
    });
}

function attachSuggestionMessage(guildId, suggestionId, channelId, messageId) {
    updateJsonFile(FILE_NAME, allData => {
        const suggestion = allData[guildId]?.suggestions?.[String(suggestionId)];
        if (!suggestion) throw new UserFacingError("That suggestion no longer exists.");
        suggestion.channelId = channelId;
        suggestion.messageId = messageId;
    });
}

function getSuggestion(guildId, suggestionId) {
    const data = readGuildData(guildId);
    return data.suggestions[String(suggestionId)] || null;
}

function listSuggestions(guildId) {
    return Object.values(readGuildData(guildId).suggestions)
        .sort((left, right) => right.id - left.id);
}

function updateSuggestion(guildId, suggestionId, updater) {
    let result = null;
    updateJsonFile(FILE_NAME, allData => {
        const suggestion = allData[guildId]?.suggestions?.[String(suggestionId)];
        if (!suggestion) return;
        updater(suggestion);
        result = { ...suggestion, votes: { ...suggestion.votes } };
    });
    return result;
}

function voteCounts(suggestion) {
    return Object.values(suggestion.votes).reduce((counts, vote) => {
        if (vote === "up") counts.up += 1;
        if (vote === "down") counts.down += 1;
        return counts;
    }, { up: 0, down: 0 });
}

function renderSuggestionEmbed(suggestion) {
    const counts = voteCounts(suggestion);
    const embed = createEmbed(`Suggestion #${suggestion.id}`,
        suggestion.status === "approved" ? COLORS.success :
            suggestion.status === "denied" ? COLORS.error : COLORS.info)
        .setDescription(suggestion.text)
        .addFields(
            { name: "Author", value: `<@${suggestion.authorId}>`, inline: true },
            { name: "Status", value: suggestion.status === "approved" ? "🟢 Approved" :
                suggestion.status === "denied" ? "🔴 Denied" : "🟡 Pending", inline: true },
            { name: "Votes", value: `👍 ${counts.up} · 👎 ${counts.down}`, inline: true }
        )
        .setTimestamp(new Date(suggestion.createdAt));

    if (suggestion.decision) {
        embed.addFields(
            { name: suggestion.status === "approved" ? "Approved by" : "Denied by",
                value: `<@${suggestion.decision.byId}>`, inline: true },
            { name: "Decision reason", value: suggestion.decision.reason }
        );
    }
    return embed;
}

function renderSuggestionComponents(suggestion) {
    const isPending = suggestion.status === "pending";
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`sug:vote:${suggestion.id}:up`)
                .setLabel(`Upvote (${voteCounts(suggestion).up})`)
                .setStyle(ButtonStyle.Primary)
                .setEmoji("👍")
                .setDisabled(!isPending),
            new ButtonBuilder()
                .setCustomId(`sug:vote:${suggestion.id}:down`)
                .setLabel(`Downvote (${voteCounts(suggestion).down})`)
                .setStyle(ButtonStyle.Secondary)
                .setEmoji("👎")
                .setDisabled(!isPending)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`sug:decide:${suggestion.id}:approve`)
                .setLabel("Approve")
                .setStyle(ButtonStyle.Success)
                .setEmoji("✅")
                .setDisabled(!isPending),
            new ButtonBuilder()
                .setCustomId(`sug:decide:${suggestion.id}:deny`)
                .setLabel("Deny")
                .setStyle(ButtonStyle.Danger)
                .setEmoji("❌")
                .setDisabled(!isPending)
        )
    ];
}

function listPagePayload(guildId, page) {
    const suggestions = listSuggestions(guildId);
    const pageSize = 10;
    const pageCount = Math.max(1, Math.ceil(suggestions.length / pageSize));
    const safePage = Math.min(Math.max(page, 0), pageCount - 1);
    const entries = suggestions.slice(safePage * pageSize, (safePage + 1) * pageSize);
    const description = entries.length
        ? entries.map(suggestion => {
            const status = suggestion.status[0].toUpperCase() + suggestion.status.slice(1);
            const text = suggestion.text.replace(/\s+/g, " ").slice(0, 100);
            return `**#${suggestion.id} · ${status}** — ${text}${suggestion.text.length > 100 ? "…" : ""}`;
        }).join("\n")
        : "No suggestions have been submitted.";
    const embed = createEmbed(`Suggestions · Page ${safePage + 1}/${pageCount}`)
        .setDescription(description);
    const components = [];
    if (pageCount > 1) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`sug:list:${safePage - 1}`)
                .setLabel("Previous")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage === 0),
            new ButtonBuilder()
                .setCustomId(`sug:list:${safePage + 1}`)
                .setLabel("Next")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(safePage >= pageCount - 1)
        ));
    }
    return { embeds: [embed], components };
}

async function fetchSuggestionMessage(client, suggestion) {
    if (!suggestion.messageId || !suggestion.channelId) return null;
    const channel = await client.channels.fetch(suggestion.channelId);
    if (!channel || !channel.isTextBased() || !channel.isSendable()) return null;
    return channel.messages.fetch(suggestion.messageId);
}

async function replyEphemeral(interaction, content) {
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, ephemeral: true });
    } else {
        await interaction.reply({ content, ephemeral: true });
    }
}

async function handleSuggestionComponent(interaction) {
    if (!interaction.customId.startsWith("sug:")) return false;
    const parts = interaction.customId.split(":");
    const [prefix, action, idOrPage, value] = parts;
    if (prefix !== "sug") return false;

    if (action === "list" && interaction.isButton()) {
        const page = Number(idOrPage);
        if (!Number.isSafeInteger(page) || page < 0) {
            await replyEphemeral(interaction, "That suggestion list page is invalid.");
            return true;
        }
        const payload = listPagePayload(interaction.guildId, page);
        await interaction.update(payload);
        return true;
    }

    if (action === "vote" && interaction.isButton()) {
        if (interaction.user.bot) {
            await replyEphemeral(interaction, "Bots cannot vote on suggestions.");
            return true;
        }
        const suggestion = getSuggestion(interaction.guildId, idOrPage);
        if (!suggestion || suggestion.messageId !== interaction.message.id) {
            await replyEphemeral(interaction, "That suggestion could not be found.");
            return true;
        }
        if (suggestion.status !== "pending") {
            await replyEphemeral(interaction, "Voting has closed for this suggestion.");
            return true;
        }
        if (value !== "up" && value !== "down") {
            await replyEphemeral(interaction, "That vote action is invalid.");
            return true;
        }

        let alreadyHadVote = false;
        const updated = updateSuggestion(interaction.guildId, idOrPage, current => {
            if (current.status !== "pending") return;
            alreadyHadVote = current.votes[interaction.user.id] === value;
            if (alreadyHadVote) return;
            current.votes[interaction.user.id] = value;
        });
        if (!updated || updated.status !== "pending") {
            await replyEphemeral(interaction, "Voting has closed for this suggestion.");
            return true;
        }
        if (alreadyHadVote) {
            await replyEphemeral(interaction, "Your vote is already recorded. You can change it by choosing the other option.");
            return true;
        }

        await interaction.update({
            embeds: [renderSuggestionEmbed(updated)],
            components: renderSuggestionComponents(updated)
        });
        return true;
    }

    if (action === "decide" && interaction.isButton()) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
            !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await replyEphemeral(interaction, "Only administrators or members with Manage Server can decide suggestions.");
            return true;
        }
        const suggestion = getSuggestion(interaction.guildId, idOrPage);
        if (!suggestion || suggestion.messageId !== interaction.message.id) {
            await replyEphemeral(interaction, "That suggestion could not be found.");
            return true;
        }
        if (suggestion.status !== "pending") {
            await replyEphemeral(interaction, "That suggestion has already been decided.");
            return true;
        }
        if (value !== "approve" && value !== "deny") {
            await replyEphemeral(interaction, "That decision is invalid.");
            return true;
        }

        const modal = new ModalBuilder()
            .setCustomId(`sug:decision:${idOrPage}:${value}`)
            .setTitle(value === "approve" ? "Approve suggestion" : "Deny suggestion")
            .addComponents(new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("reason")
                    .setLabel("Decision reason")
                    .setStyle(TextInputStyle.Paragraph)
                    .setMinLength(1)
                    .setMaxLength(1000)
                    .setRequired(true)
            ));
        await interaction.showModal(modal);
        return true;
    }

    if (action === "decision" && interaction.isModalSubmit()) {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) &&
            !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            await replyEphemeral(interaction, "Only administrators or members with Manage Server can decide suggestions.");
            return true;
        }
        if (value !== "approve" && value !== "deny") {
            await replyEphemeral(interaction, "That decision is invalid.");
            return true;
        }

        const reason = interaction.fields.getTextInputValue("reason").trim();
        if (!reason) {
            await replyEphemeral(interaction, "Please enter a decision reason.");
            return true;
        }
        const suggestion = getSuggestion(interaction.guildId, idOrPage);
        if (!suggestion || suggestion.status !== "pending") {
            await replyEphemeral(interaction, "That suggestion has already been decided or no longer exists.");
            return true;
        }

        const status = value === "approve" ? "approved" : "denied";
        const updated = updateSuggestion(interaction.guildId, idOrPage, current => {
            if (current.status !== "pending") return;
            current.status = status;
            current.decision = {
                byId: interaction.user.id,
                reason,
                decidedAt: new Date().toISOString()
            };
        });
        if (!updated || updated.status !== status) {
            await replyEphemeral(interaction, "That suggestion has already been decided.");
            return true;
        }

        await interaction.deferReply({ ephemeral: true });
        let messageUpdated = false;
        try {
            const message = await fetchSuggestionMessage(interaction.client, updated);
            if (message) {
                await message.edit({
                    embeds: [renderSuggestionEmbed(updated)],
                    components: renderSuggestionComponents(updated)
                });
                messageUpdated = true;
            }
        } catch (error) {
            console.error("Failed to update decided suggestion message:", {
                suggestionId: updated.id,
                code: error.code || error.name
            });
        }
        await interaction.editReply(messageUpdated
            ? `Suggestion #${updated.id} marked **${status}**.`
            : `Suggestion #${updated.id} was saved as **${status}**, but its posted message could not be updated.`);
        return true;
    }

    return false;
}

module.exports = {
    configureSuggestions,
    disableSuggestions,
    readGuildData,
    createSuggestion,
    discardSuggestion,
    attachSuggestionMessage,
    getSuggestion,
    listSuggestions,
    updateSuggestion,
    voteCounts,
    renderSuggestionEmbed,
    renderSuggestionComponents,
    listPagePayload,
    handleSuggestionComponent
};
