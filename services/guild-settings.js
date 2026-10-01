const { readJsonFile, updateJsonFile } = require("./storage");

const FILE_NAME = "guild-settings.json";

function getGuildSettings(guildId) {
    const allSettings = readJsonFile(FILE_NAME, {});
    return { ...(allSettings[guildId] || {}) };
}

function setModerationLogChannel(guildId, channelId) {
    return updateJsonFile(FILE_NAME, allSettings => {
        allSettings[guildId] = {
            ...(allSettings[guildId] || {}),
            moderationLogChannelId: channelId
        };
    });
}

function disableModerationLog(guildId) {
    return updateJsonFile(FILE_NAME, allSettings => {
        allSettings[guildId] = {
            ...(allSettings[guildId] || {}),
            moderationLogChannelId: null
        };
    });
}

module.exports = {
    getGuildSettings,
    setModerationLogChannel,
    disableModerationLog
};
