const { randomUUID } = require("node:crypto");
const { getDB } = require("../db");
const { UserFacingError } = require("./errors");
const { parseReminderDuration } = require("./reminder-duration");

const MAX_REMINDER_MESSAGE_LENGTH = 1000;

function reminderCollection() {
    return getDB().collection("reminders");
}

async function initializeReminderStorage() {
    const collection = reminderCollection();
    await Promise.all([
        collection.createIndex({ userId: 1, status: 1, triggerAt: 1 }),
        collection.createIndex({ status: 1, triggerAt: 1 })
    ]);

    const recovered = await collection.updateMany(
        { status: "delivering" },
        {
            $set: {
                status: "failed",
                failureReason: "Delivery was interrupted by a bot restart."
            }
        }
    );
    if (recovered.modifiedCount > 0) {
        console.warn(`Marked ${recovered.modifiedCount} interrupted reminder delivery(ies) as failed.`);
    }
}

async function createReminder(userId, duration, message, createdAt = new Date()) {
    const delay = parseReminderDuration(duration);
    if (delay === null) {
        throw new UserFacingError("Invalid duration. Use values like 10s, 5m, 2h, 1d, 1w, or 1h30m (maximum 365 days).");
    }

    if (typeof message !== "string" || !message.trim()) {
        throw new UserFacingError("Please include a message for your reminder.");
    }

    const cleanMessage = message.trim();
    if (cleanMessage.length > MAX_REMINDER_MESSAGE_LENGTH) {
        throw new UserFacingError(`Reminder messages must be ${MAX_REMINDER_MESSAGE_LENGTH} characters or fewer.`);
    }

    const reminder = {
        _id: randomUUID(),
        userId,
        createdAt,
        triggerAt: new Date(createdAt.getTime() + delay),
        message: cleanMessage,
        status: "pending"
    };
    await reminderCollection().insertOne(reminder);
    return reminder;
}

async function listPendingReminders(userId) {
    return reminderCollection()
        .find({ userId, status: "pending" })
        .sort({ triggerAt: 1 })
        .toArray();
}

async function cancelReminder(userId, reminderId) {
    const collection = reminderCollection();
    const reminder = await collection.findOne({ _id: reminderId });
    if (!reminder) {
        throw new UserFacingError("That reminder does not exist.");
    }
    if (reminder.userId !== userId) {
        throw new UserFacingError("You can only cancel your own reminders.");
    }
    if (reminder.status !== "pending") {
        throw new UserFacingError("That reminder is no longer active and cannot be cancelled.");
    }

    const result = await collection.updateOne(
        { _id: reminderId, userId, status: "pending" },
        { $set: { status: "cancelled", cancelledAt: new Date() } }
    );
    if (result.modifiedCount !== 1) {
        throw new UserFacingError("That reminder is no longer active and cannot be cancelled.");
    }
    return reminder;
}

async function claimDueReminders(now = new Date(), limit = 50) {
    const due = await reminderCollection()
        .find({ status: "pending", triggerAt: { $lte: now } })
        .sort({ triggerAt: 1 })
        .limit(limit)
        .toArray();
    const claimed = [];

    for (const reminder of due) {
        const result = await reminderCollection().updateOne(
            { _id: reminder._id, status: "pending", triggerAt: { $lte: now } },
            { $set: { status: "delivering", deliveryStartedAt: now } }
        );
        if (result.modifiedCount === 1) {
            claimed.push({ ...reminder, status: "delivering", deliveryStartedAt: now });
        }
    }
    return claimed;
}

async function markReminderDelivered(reminderId, deliveredAt = new Date()) {
    await reminderCollection().updateOne(
        { _id: reminderId, status: "delivering" },
        { $set: { status: "delivered", deliveredAt } }
    );
}

async function markReminderFailed(reminderId, failureReason) {
    await reminderCollection().updateOne(
        { _id: reminderId, status: "delivering" },
        { $set: { status: "failed", failureReason } }
    );
}

module.exports = {
    MAX_REMINDER_MESSAGE_LENGTH,
    initializeReminderStorage,
    createReminder,
    listPendingReminders,
    cancelReminder,
    claimDueReminders,
    markReminderDelivered,
    markReminderFailed
};
