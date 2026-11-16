const assert = require("node:assert/strict");
const test = require("node:test");
const hof = require("../commands/hof");
const hos = require("../commands/hos");
const { parseEmoji, renderHallEmbed } = require("../services/hall-of-fame");
const { UserFacingError } = require("../services/errors");

test("Hall commands expose emoji, channel, and reaction-threshold configuration", () => {
    for (const [command, name] of [[hof, "hof"], [hos, "hos"]]) {
        const data = command.data.toJSON();
        assert.equal(data.name, name);
        assert.deepEqual(data.options.map(option => option.name), [
            "setemoji", "setchannel", "setnum"
        ]);
        assert.deepEqual(data.options.map(option => option.options[0].name), [
            "emoji", "channel", "num"
        ]);
    }
});

test("emoji settings accept custom and single Unicode emoji and reject multiple emoji", () => {
    assert.deepEqual(parseEmoji("<:mark:123456>"), {
        key: "123456",
        display: "<:mark:123456>"
    });
    assert.deepEqual(parseEmoji("🏆"), { key: "🏆", display: "🏆" });
    assert.throws(() => parseEmoji("🏆💩"), UserFacingError);
});

test("hall embeds recreate the source text, author, avatar, and image", () => {
    const embed = renderHallEmbed({
        author: {
            username: "Mark",
            displayAvatarURL: () => "https://example.com/avatar.png"
        },
        content: "A message",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        url: "https://discord.com/channels/guild/channel/message",
        attachments: new Map([["image", {
            contentType: "image/png",
            url: "https://example.com/image.png"
        }]]),
        embeds: []
    }, "hof").toJSON();

    assert.equal(embed.author.name, "Mark");
    assert.equal(embed.author.icon_url, "https://example.com/avatar.png");
    assert.equal(embed.description, "A message");
    assert.equal(embed.image.url, "https://example.com/image.png");
});
