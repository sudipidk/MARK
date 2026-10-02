const {
    claimDueReminders,
    markReminderDelivered,
    markReminderFailed
} = require("./reminder-storage");

const POLL_INTERVAL_MS = 10 * 1000;
let schedulerTimer;
let processing = false;

async function deliverReminder(client, reminder) {
    try {
        const user = await client.users.fetch(reminder.userId);
        await user.send({
            embeds: [{
                color: 0xF1C40F,
                title: "⏰ Reminder",
                description: `You asked me to remind you:\n\n${reminder.message}`,
                footer: { text: `Reminder ID: ${reminder._id}` }
            }],
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        const failureReason = `Discord delivery failed (${error.code || error.name || "unknown error"}).`;
        await markReminderFailed(reminder._id, failureReason);
        console.error("Reminder DM could not be delivered:", {
            reminderId: reminder._id,
            userId: reminder.userId,
            code: error.code || error.name
        });
        return;
    }

    await markReminderDelivered(reminder._id);
}

async function processDueReminders(client) {
    if (processing) return;
    processing = true;
    try {
        while (true) {
            const claimed = await claimDueReminders(new Date(), 1);
            if (claimed.length === 0) break;
            for (const reminder of claimed) {
                try {
                    await deliverReminder(client, reminder);
                } catch (error) {
                    console.error("Failed to update reminder delivery status:", {
                        reminderId: reminder._id,
                        code: error.code || error.name
                    });
                }
            }
        }
    } finally {
        processing = false;
    }
}

function startReminderScheduler(client) {
    if (schedulerTimer) return;

    const tick = () => {
        processDueReminders(client).catch(error => {
            console.error("Reminder scheduler failed:", {
                code: error.code || error.name
            });
        });
    };
    tick();
    schedulerTimer = setInterval(tick, POLL_INTERVAL_MS);
    schedulerTimer.unref();
}

module.exports = {
    startReminderScheduler,
    processDueReminders
};
