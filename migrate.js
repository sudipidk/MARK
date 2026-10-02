require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { closeDB, connectDB, getDB } = require("./db");
const { getDataDirectory } = require("./services/storage");

async function migrateCountingData() {
    const dataPath = path.join(getDataDirectory(), "counting.json");
    if (!fs.existsSync(dataPath)) {
        throw new Error(`Counting data file was not found: ${dataPath}`);
    }

    const legacyData = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    if (!legacyData || typeof legacyData !== "object" || Array.isArray(legacyData)) {
        throw new Error("counting.json must contain an object keyed by guild ID.");
    }

    const records = Object.entries(legacyData).map(([guildId, data]) => {
        if (!guildId || !data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error(`Invalid counting data for guild ${guildId || "(empty ID)"}.`);
        }
        const { _id, ...serverData } = data;
        return {
            updateOne: {
                filter: { _id: guildId },
                update: { $setOnInsert: serverData },
                upsert: true
            }
        };
    });

    await connectDB();
    try {
        if (records.length > 0) {
            await getDB().collection("counting").bulkWrite(records, { ordered: true });
        }
        console.log(
            `✅ Processed ${records.length} counting server record(s) in MongoDB; existing MongoDB records were preserved`
        );
    } finally {
        await closeDB();
    }

    return records.length;
}

if (require.main === module) {
    migrateCountingData().catch(error => {
        console.error("❌ Failed to migrate counting data:", error);
        process.exitCode = 1;
    });
}

module.exports = {
    migrateCountingData
};
