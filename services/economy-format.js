const { UserFacingError } = require("./errors");

function assertGuildInteraction(interaction) {
    if (!interaction.guildId || !interaction.guild) {
        throw new UserFacingError("Economy commands are only available in a server.");
    }
    if (interaction.user?.bot) {
        throw new UserFacingError("Bot accounts cannot use the economy.");
    }
}

function assertCoinAmount(value, label = "Amount") {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new UserFacingError(`${label} must be a positive whole number.`);
    }
    return value;
}

function sanitizeDisplayText(value) {
    return String(value || "Unknown user")
        .replace(/@/g, "@\u200b")
        .replace(/[`*_~|>]/g, "")
        .slice(0, 80);
}

function formatCoins(amount) {
    return `${Number(amount || 0).toLocaleString("en-US")} coins`;
}

function formatDuration(milliseconds) {
    const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60000));
    if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    const parts = [];
    if (days) parts.push(`${days} day${days === 1 ? "" : "s"}`);
    if (remainingHours) parts.push(`${remainingHours} hour${remainingHours === 1 ? "" : "s"}`);
    if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
    return parts.join(", ");
}

async function getTitleAwareDisplayName(guildId, user, member) {
    const base = sanitizeDisplayText(member?.displayName || user.globalName || user.username || user.tag);
    if (!guildId || !user?.id) return base;

    const { getDB } = require("../db");
    const account = await getDB().collection("economyAccounts").findOne(
        { _id: user.id },
        { projection: { equippedTitleId: 1, equippedVariantCode: 1 } }
    );
    if (!account?.equippedTitleId) return base;

    const { getCatalogItem } = require("./economy-catalog");
    const title = getCatalogItem(account.equippedTitleId);
    if (!title || title.category !== "title") return base;
    const titleName = title.id === "variant" && account.equippedVariantCode
        ? `Variant ${account.equippedVariantCode}`
        : title.name;
    return `[${sanitizeDisplayText(titleName)}] ${base}`;
}

module.exports = {
    assertGuildInteraction,
    assertCoinAmount,
    sanitizeDisplayText,
    formatCoins,
    formatDuration,
    getTitleAwareDisplayName
};
