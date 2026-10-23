const fs = require("fs");
const path = require("path");

function getDataDirectory() {
    const configuredDirectory = process.env.BOT_DATA_DIR || process.env.COUNTING_DATA_DIR;
    return configuredDirectory
        ? path.resolve(configuredDirectory)
        : path.join(__dirname, "..", "data");
}

function readJsonFile(fileName, defaultValue) {
    const filePath = path.join(getDataDirectory(), fileName);
    if (!fs.existsSync(filePath)) return defaultValue;

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`${fileName} must contain a JSON object.`);
    }
    return data;
}

function readBundledJsonFile(fileName, defaultValue) {
    const filePath = path.join(__dirname, "..", "data", fileName);
    if (!fs.existsSync(filePath)) return defaultValue;

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`${fileName} must contain a JSON object.`);
    }
    return data;
}

function updateJsonFile(fileName, updater, defaultValue = {}) {
    const data = readJsonFile(fileName, defaultValue);
    updater(data);

    const directory = getDataDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, fileName);
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(data, null, 2));
    fs.renameSync(temporaryPath, filePath);
    return data;
}

module.exports = {
    getDataDirectory,
    readJsonFile,
    readBundledJsonFile,
    updateJsonFile
};
