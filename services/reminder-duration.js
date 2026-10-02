const MAX_REMINDER_DURATION_MS = 365 * 24 * 60 * 60 * 1000;
const UNIT_MILLISECONDS = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
};
const UNIT_ORDER = ["w", "d", "h", "m", "s"];

function parseReminderDuration(input) {
    if (typeof input !== "string") return null;
    const text = input.trim().toLowerCase();
    if (!text) return null;

    const parts = [...text.matchAll(/(\d+)([smhdw])/g)];
    if (parts.length === 0 || parts.map(part => part[0]).join("") !== text) return null;

    let total = 0;
    let previousUnitIndex = -1;
    for (const [, amountText, unit] of parts) {
        const amount = Number(amountText);
        const unitIndex = UNIT_ORDER.indexOf(unit);
        if (
            !Number.isSafeInteger(amount) ||
            amount <= 0 ||
            unitIndex <= previousUnitIndex
        ) {
            return null;
        }

        total += amount * UNIT_MILLISECONDS[unit];
        if (!Number.isSafeInteger(total) || total > MAX_REMINDER_DURATION_MS) return null;
        previousUnitIndex = unitIndex;
    }

    return total;
}

module.exports = {
    MAX_REMINDER_DURATION_MS,
    parseReminderDuration
};
