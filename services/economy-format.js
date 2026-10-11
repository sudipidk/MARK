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

function compactCurrencyNumber(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric === 0) return "0";
    const abs = Math.abs(numeric);
    const units = ["", "k", "m", "b", "t"];
    const unitIndex = Math.min(
        units.length - 1,
        Math.floor(Math.log10(abs) / 3)
    );
    const scaled = abs / (10 ** (unitIndex * 3));
    const formatted = scaled >= 100
        ? scaled.toFixed(0)
        : scaled >= 10
            ? scaled.toFixed(1).replace(/\.0$/, "")
            : scaled.toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    return `${formatted}${units[unitIndex]}`;
}

function formatCoins(amount) {
    const numeric = Number(amount || 0);
    const exact = Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
    return `${exact.toLocaleString("en-US")} coins (${compactCurrencyNumber(exact)})`;
}

function parseCompactCurrencyInput(value, options = {}) {
    const { allowZero = false, label = "Amount" } = options;
    if (value === null || value === undefined || value === "") {
        throw new UserFacingError(`${label} is required.`);
    }
    let raw = value;
    if (typeof raw === "number") {
        if (!Number.isFinite(raw) || Number.isNaN(raw)) {
            throw new UserFacingError(`${label} is not a valid number.`);
        }
        if (!Number.isSafeInteger(raw)) {
            throw new UserFacingError(`${label} exceeds the safe integer limit.`);
        }
        if (raw < 0 || (!allowZero && raw <= 0)) {
            throw new UserFacingError(`${label} must be a positive whole number.`);
        }
        return raw;
    }
    if (typeof raw !== "string") {
        throw new UserFacingError(`${label} must be a whole number or compact amount such as 1k or 2.5m.`);
    }
    const trimmed = raw.trim();
    if (!trimmed || trimmed.includes("e") || trimmed.includes("E") || trimmed.includes(" ")) {
        throw new UserFacingError(`${label} is malformed. Use values like 1000, 1.5k, or 2m.`);
    }
    const match = trimmed.match(/^(-?\d+(?:\.\d+)?)([kKmMbBtT])?$/);
    if (!match) {
        throw new UserFacingError(`${label} is malformed. Use values like 1000, 1.5k, or 2m.`);
    }
    const [, numberPart, suffix = ""] = match;
    const parsed = Number(numberPart);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
        throw new UserFacingError(`${label} is not a valid number.`);
    }
    const multiplier = { k: 1_000, K: 1_000, m: 1_000_000, M: 1_000_000, b: 1_000_000_000, B: 1_000_000_000, t: 1_000_000_000_000, T: 1_000_000_000_000 }[suffix] || 1;
    const total = parsed * multiplier;
    if (!Number.isSafeInteger(total)) {
        throw new UserFacingError(`${label} exceeds the safe integer limit.`);
    }
    if (!Number.isInteger(total)) {
        throw new UserFacingError(`${label} resolves to a fractional coin value.`);
    }
    if (total < 0 || (!allowZero && total <= 0)) {
        throw new UserFacingError(`${label} must be a positive whole number.`);
    }
    if (!Number.isInteger(parsed) && !["k", "K", "m", "M", "b", "B", "t", "T"].includes(suffix)) {
        throw new UserFacingError(`${label} cannot include unsupported fractional coin values.`);
    }
    if (suffix && !/^\d+$/.test(numberPart.split(".")[0]) && Number.isInteger(parsed) === false) {
        throw new UserFacingError(`${label} is malformed.`);
    }
    return total;
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
    compactCurrencyNumber,
    formatCoins,
    parseCompactCurrencyInput,
    formatDuration,
    getTitleAwareDisplayName
};
