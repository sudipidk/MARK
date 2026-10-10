const config = require("./economy-config");

function getStealSuccessPercent(activeBodyguards) {
    const count = Math.max(0, Math.min(
        config.shop.maximumActiveBodyguards,
        Math.floor(activeBodyguards)
    ));
    return config.steal.successPercentByGuards[count];
}

function calculateStealFine(preFineWallet) {
    if (!Number.isSafeInteger(preFineWallet) || preFineWallet < 0) {
        throw new TypeError("A non-negative integer wallet balance is required.");
    }
    return Number((BigInt(preFineWallet) * BigInt(config.steal.finePercent)) / 100n);
}

function calculateStealAmount(targetWallet, percentage, maximum = config.steal.maximumAmount) {
    if (!Number.isSafeInteger(targetWallet) || targetWallet < 0 ||
        !Number.isSafeInteger(percentage) || percentage < 0 ||
        !Number.isSafeInteger(maximum) || maximum < 0) {
        throw new TypeError("Steal amount inputs must be non-negative integers.");
    }
    if (targetWallet === 0 || percentage === 0 || maximum === 0) return 0;
    const percentageAmount = Number((BigInt(targetWallet) * BigInt(percentage)) / 100n);
    return Math.min(maximum, Math.max(1, percentageAmount));
}

function resolveCoinflip(roll, winPercent, stake, multiplier = config.coinflip.totalWinMultiplier) {
    if (!Number.isSafeInteger(roll) || roll < 0 || roll >= 100 ||
        !Number.isSafeInteger(winPercent) || winPercent < 0 || winPercent > 100 ||
        !Number.isSafeInteger(stake) || stake <= 0 ||
        !Number.isSafeInteger(multiplier) || multiplier < 1) {
        throw new TypeError("Invalid coinflip outcome inputs.");
    }
    const won = roll < winPercent;
    const payout = won ? stake * multiplier : 0;
    return { won, payout, net: payout - stake };
}

function getZonedDateParts(date, timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(date);
    return Object.fromEntries(parts
        .filter(part => part.type !== "literal")
        .map(part => [part.type, Number(part.value)]));
}

function localDateTimeToUtc(year, month, day, hour, minute, timeZone) {
    const target = Date.UTC(year, month - 1, day, hour, minute);
    let candidate = target;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const local = getZonedDateParts(new Date(candidate), timeZone);
        const displayedAsUtc = Date.UTC(
            local.year,
            local.month - 1,
            local.day,
            local.hour,
            local.minute,
            local.second
        );
        const difference = target - displayedAsUtc;
        candidate += difference;
        if (difference === 0) break;
    }
    return new Date(candidate);
}

function getKathmanduPeriod(
    date,
    weekly = false,
    timeZone = "Asia/Kathmandu",
    boundary = weekly ? "Monday 00:00" : "00:00"
) {
    const local = getZonedDateParts(date, timeZone);
    const weekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const [weekdayName, time] = weekly ? boundary.split(/\s+/) : [null, boundary];
    const startWeekday = weekly ? weekdayNames.indexOf(weekdayName) : weekday;
    if (weekly && startWeekday < 0) throw new TypeError("Invalid weekly economy boundary weekday.");
    const [hour, minute] = time.split(":").map(Number);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 ||
        !Number.isInteger(minute) || minute < 0 || minute > 59) {
        throw new TypeError("Invalid economy boundary time.");
    }
    const daysSinceStart = weekly ? (weekday - startWeekday + 7) % 7 : 0;
    const startLocal = new Date(Date.UTC(local.year, local.month - 1, local.day - daysSinceStart));
    const year = startLocal.getUTCFullYear();
    const month = startLocal.getUTCMonth() + 1;
    const day = startLocal.getUTCDate();
    const startAt = localDateTimeToUtc(year, month, day, hour, minute, timeZone);
    const nextLocal = new Date(Date.UTC(year, month - 1, day + (weekly ? 7 : 1)));
    const endAt = localDateTimeToUtc(
        nextLocal.getUTCFullYear(),
        nextLocal.getUTCMonth() + 1,
        nextLocal.getUTCDate(),
        hour,
        minute,
        timeZone
    );
    const periodId = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return {
        periodId,
        startAt,
        endAt
    };
}

module.exports = {
    getStealSuccessPercent,
    calculateStealFine,
    calculateStealAmount,
    resolveCoinflip,
    getKathmanduPeriod
};
