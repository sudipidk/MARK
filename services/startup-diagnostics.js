function getStartupConfig(environment = process.env) {
    const token = typeof environment.TOKEN === "string" ? environment.TOKEN.trim() : "";
    const mongoUri = typeof environment.MONGODB_URI === "string" && environment.MONGODB_URI.trim()
        ? environment.MONGODB_URI.trim()
        : typeof environment.MONGO_URL === "string"
            ? environment.MONGO_URL.trim()
            : "";

    if (!token) {
        throw new Error("TOKEN is missing or empty. Set it in the hosting provider's environment variables.");
    }
    if (!mongoUri) {
        throw new Error("MONGODB_URI is missing or empty. Set it to the MongoDB connection string in the hosting provider's environment variables.");
    }
    if (!/^mongodb(?:\+srv)?:\/\//i.test(mongoUri)) {
        throw new Error("The MongoDB connection string must begin with mongodb:// or mongodb+srv://.");
    }

    return { token, mongoUri };
}

function redactKnownSecrets(message, secrets) {
    let safeMessage = message;
    for (const secret of secrets) {
        if (typeof secret === "string" && secret.length > 0) {
            safeMessage = safeMessage.split(secret).join("[REDACTED]");
        }
    }

    return safeMessage
        .replace(/(mongodb(?:\+srv)?:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@")
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+:[^/@\s]+@/gi, "$1[REDACTED]@")
        .replace(/\b(password|passwd|token|secret|api[_-]?key)=([^&\s]+)/gi, "$1=[REDACTED]")
        .slice(0, 500);
}

function formatStartupError(error, secrets = []) {
    const name = typeof error?.name === "string" ? error.name : "Error";
    const code = typeof error?.code === "string" || typeof error?.code === "number"
        ? String(error.code)
        : undefined;
    const message = typeof error?.message === "string" && error.message
        ? error.message
        : "No error message was provided.";

    return {
        name,
        ...(code ? { code } : {}),
        message: redactKnownSecrets(message, secrets)
    };
}

module.exports = {
    getStartupConfig,
    formatStartupError
};
