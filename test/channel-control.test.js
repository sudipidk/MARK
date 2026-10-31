const assert = require("node:assert/strict");
const test = require("node:test");
const { analyzeMessage, isEmojiOnlyText } = require("../services/channel-message-analyzer");
const { hasViolation } = require("../services/channel-enforcer");
const { DEFAULT_CONFIG } = require("../services/channel-config");
const channelConfigCommand = require("../commands/channelconfig");

function message({
    content = "",
    attachments = [],
    embeds = [],
    stickers = 0
} = {}) {
    return {
        content,
        attachments: new Map(attachments.map((attachment, index) => [index, attachment])),
        embeds,
        stickers: { size: stickers }
    };
}

test("classifies Unicode and custom Discord emoji without treating prose as emoji", () => {
    for (const content of [
        "😀😂🔥",
        "👍🏽",
        "👨‍👩‍👧‍👦",
        "🇳🇵",
        "1️⃣",
        "<:custom_emoji:12345678901234567>",
        "<a:animated:123456789012345678> 😀"
    ]) {
        assert.equal(isEmojiOnlyText(content), true, content);
        assert.equal(analyzeMessage(message({ content })).emoji, true, content);
        assert.equal(analyzeMessage(message({ content })).text, false, content);
    }

    for (const content of ["Hello 😀", ":", "42", "©", "ok <:custom:12345678901234567>"]) {
        assert.equal(isEmojiOnlyText(content), false, content);
        assert.equal(analyzeMessage(message({ content })).text, true, content);
    }
    assert.equal(analyzeMessage(message({ content: "ok <:custom:12345678901234567>" })).emoji, true);
});

test("detects every category present in mixed-content messages", () => {
    assert.deepEqual(analyzeMessage(message({
        content: "Hello 😀",
        attachments: [{ name: "reaction.gif", contentType: "image/gif" }],
        stickers: 1
    })), {
        gif: true,
        emoji: true,
        media: false,
        sticker: true,
        text: true,
        unknown: false
    });

    const categories = analyzeMessage(message({
        content: "https://media.tenor.com/abc.gif",
        attachments: [{ name: "photo.webp", contentType: "image/webp" }],
        embeds: [
            { type: "video", video: { url: "https://cdn.example/video.mp4" } },
            {
                type: "rich",
                provider: { name: "Tenor" },
                thumbnail: { url: "https://cdn.example/preview.jpg" }
            }
        ]
    }));
    assert.equal(categories.gif, true);
    assert.equal(categories.media, true);
    assert.equal(categories.text, false);
});

test("does not classify ordinary images as GIFs and rejects unknown attachments safely", () => {
    assert.deepEqual(analyzeMessage(message({
        attachments: [{ name: "photo.png", contentType: "image/png" }]
    })), {
        gif: false,
        emoji: false,
        media: true,
        sticker: false,
        text: false,
        unknown: false
    });
    const unknown = analyzeMessage(message({
        attachments: [{ name: "file.bin", contentType: null }]
    }));
    assert.equal(unknown.unknown, true);
    assert.equal(hasViolation(
        { allowed: { ...DEFAULT_CONFIG.allowed, text: false } },
        unknown
    ), true);
    const gifEmbed = analyzeMessage(message({
        embeds: [{
            type: "rich",
            provider: { name: "Tenor" },
            thumbnail: { url: "https://cdn.example/preview.jpg" }
        }]
    }));
    assert.equal(gifEmbed.gif, true);
    assert.equal(gifEmbed.media, false);
});

test("allows only enabled categories, including emoji and sticker combinations", () => {
    const allDisabled = {
        allowed: { gif: false, emoji: false, media: false, sticker: false, text: false }
    };
    assert.equal(hasViolation(allDisabled, analyzeMessage(message({ content: "ordinary message" }))), true);

    const onlyEmojiAndSticker = {
        allowed: { gif: false, emoji: true, media: false, sticker: true, text: false }
    };
    assert.equal(hasViolation(onlyEmojiAndSticker, analyzeMessage(message({ content: "😀" }))), false);
    assert.equal(hasViolation(onlyEmojiAndSticker, analyzeMessage(message({ stickers: 1 }))), false);
    assert.equal(hasViolation(
        onlyEmojiAndSticker,
        analyzeMessage(message({ content: "😀", stickers: 1 }))
    ), false);
    assert.equal(hasViolation(
        onlyEmojiAndSticker,
        analyzeMessage(message({ content: "hello 😀", stickers: 1 }))
    ), true);
    const textWithoutEmoji = {
        allowed: { gif: false, emoji: false, media: false, sticker: false, text: true }
    };
    assert.equal(hasViolation(textWithoutEmoji, analyzeMessage(message({ content: "hello" }))), false);
    assert.equal(hasViolation(
        textWithoutEmoji,
        analyzeMessage(message({ content: "hello 😀" }))
    ), true);

    const mediaWithoutGif = {
        allowed: { gif: false, emoji: true, media: true, sticker: true, text: true }
    };
    assert.equal(hasViolation(
        mediaWithoutGif,
        analyzeMessage(message({ attachments: [{ name: "photo.jpg", contentType: "image/jpeg" }] }))
    ), false);
    assert.equal(hasViolation(
        mediaWithoutGif,
        analyzeMessage(message({ attachments: [{ name: "loop.gif", contentType: "image/gif" }] }))
    ), true);
});

test("provides all required slash subcommands and is restricted to channel managers", () => {
    const command = channelConfigCommand.data.toJSON();
    assert.equal(command.name, "channelconfig");
    assert.deepEqual(
        command.options.map(option => option.name),
        ["gif", "emoji", "media", "sticker", "text", "all", "delete", "timeout", "threshold", "view", "disable", "reset"]
    );
    for (const subcommand of command.options) {
        assert.equal(subcommand.options[0].name, "channel", `${subcommand.name} channel option order`);
    }
    assert.ok(command.default_member_permissions);
});
