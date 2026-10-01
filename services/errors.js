class UserFacingError extends Error {
    constructor(message) {
        super(message);
        this.name = "UserFacingError";
    }
}

function getDiscordErrorMessage(error) {
    switch (error.code) {
        case 50001:
            return "MARK cannot access that server resource. Check its channel permissions.";
        case 50013:
            return "MARK is missing a permission needed to complete that action.";
        case 10007:
            return "That user is not a member of this server.";
        case 10026:
            return "That user is not currently banned.";
        case 10003:
            return "That channel could not be found or accessed.";
        default:
            return "The request could not be completed. Check MARK's permissions and try again.";
    }
}

function getUserFacingMessage(error) {
    if (error instanceof UserFacingError) return error.message;
    if (typeof error.code === "number") return getDiscordErrorMessage(error);
    return "An unexpected error occurred. Please try again later.";
}

module.exports = {
    UserFacingError,
    getUserFacingMessage
};
