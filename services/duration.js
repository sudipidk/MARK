const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const UNIT_MILLISECONDS = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
};

function parseDuration(input) {
    const text = input.trim().toLowerCase();
    if (!text) return null;

    const parts = [...text.matchAll(/(\d+)(s|m|h|d)/g)];
    if (parts.length === 0 || parts.map(part => part[0]).join("") !== text) return null;

    let total = 0;
    for (const [, amountText, unit] of parts) {
        const amount = Number(amountText);
        if (!Number.isSafeInteger(amount) || amount <= 0) return null;
        total += amount * UNIT_MILLISECONDS[unit];
        if (!Number.isSafeInteger(total) || total > MAX_TIMEOUT_MS) return null;
    }

    return total;
}

function formatDuration(milliseconds) {
    let remaining = milliseconds;
    const units = [
        ["d", 24 * 60 * 60 * 1000],
        ["h", 60 * 60 * 1000],
        ["m", 60 * 1000],
        ["s", 1000]
    ];
    const parts = [];

    for (const [label, size] of units) {
        const amount = Math.floor(remaining / size);
        if (amount > 0) {
            parts.push(`${amount}${label}`);
            remaining %= size;
        }
    }

    return parts.join(" ") || "0s";
}

module.exports = {
    MAX_TIMEOUT_MS,
    parseDuration,
    formatDuration
};
