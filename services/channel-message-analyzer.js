const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const CUSTOM_EMOJI_PATTERN = /<a?:[A-Za-z0-9_]{2,32}:\d{17,20}>/g;
const EMOJI_GRAPHEME_PATTERN =
    /^(?:(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)|(?:\p{Regional_Indicator}{2})|(?:[0-9#*]\uFE0F?\u20E3)|(?:\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F})$/u;
const GIF_FILE_PATTERN = /\.(?:gif|gifv)(?:$|[?#])/i;
const MEDIA_FILE_PATTERN =
    /\.(?:jpe?g|jfif|png|apng|webp|avif|bmp|tiff?|heic|heif|svg|jxl|mp4|mov|webm|m4v|avi|mpeg|mpg|3gp|mkv|wmv|flv|ogv|ts)(?:$|[?#])/i;
const GIF_PROVIDER_PATTERN = /(?:^|\.)((?:tenor|giphy|gfycat|redgifs)\.com)$/i;
const KLIPY_GIF_PATH_PATTERN = /\/gifs?(?:\/|$)/i;

function addUrlCategory(url, categories) {
    if (typeof url !== "string" || !url) return null;
    const cleanUrl = url.replace(/[)>.,!?\]}]+$/, "");
    let parsedUrl;
    try {
        parsedUrl = new URL(cleanUrl);
    } catch {
        return null;
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const isKlipyGif = /(?:^|\.)klipy\.com$/i.test(hostname) &&
        KLIPY_GIF_PATH_PATTERN.test(parsedUrl.pathname);
    if (GIF_FILE_PATTERN.test(cleanUrl) || GIF_PROVIDER_PATTERN.test(hostname) || isKlipyGif) {
        categories.gif = true;
        return "gif";
    }
    if (MEDIA_FILE_PATTERN.test(cleanUrl)) {
        categories.media = true;
        return "media";
    }
    return null;
}

function analyzeText(text) {
    let containsEmoji = false;
    let containsText = false;
    const withoutCustomEmojis = text.replace(CUSTOM_EMOJI_PATTERN, () => {
        containsEmoji = true;
        return " ";
    });
    for (const { segment } of segmenter.segment(withoutCustomEmojis)) {
        if (/^\s+$/u.test(segment)) continue;
        if (EMOJI_GRAPHEME_PATTERN.test(segment)) containsEmoji = true;
        else containsText = true;
    }
    return { containsEmoji, containsText };
}

function isEmojiOnlyText(text) {
    const analysis = analyzeText(text);
    return analysis.containsEmoji && !analysis.containsText;
}

function attachmentCategory(attachment, categories) {
    const name = attachment.name || attachment.url || "";
    const contentType = (attachment.contentType || "").toLowerCase();
    let hostname = "";
    try {
        hostname = new URL(attachment.url).hostname.toLowerCase();
    } catch {
        // Attachment URLs may be absent from synthetic or cached message data.
    }
    if (contentType === "image/gif" || GIF_FILE_PATTERN.test(name) ||
        GIF_PROVIDER_PATTERN.test(hostname)) {
        categories.gif = true;
        return;
    }
    if (contentType.startsWith("image/") || contentType.startsWith("video/") ||
        MEDIA_FILE_PATTERN.test(name)) {
        categories.media = true;
        return;
    }
    categories.unknown = true;
}

function embedCategory(embed, categories) {
    const providerName = embed.provider?.name || "";
    const providerUrl = embed.provider?.url || "";
    const urls = [
        embed.url,
        embed.image?.url,
        embed.thumbnail?.url,
        embed.video?.url,
        providerUrl
    ].filter(Boolean);

    const embeddedCategories = { gif: false, media: false };
    for (const url of urls) {
        addUrlCategory(url, embeddedCategories);
    }
    const isGif = /tenor|giphy|gfycat|redgifs/i.test(providerName) ||
        embed.type === "gifv" ||
        embed.type === "gif" ||
        embeddedCategories.gif;
    if (isGif) {
        categories.gif = true;
    } else if (embeddedCategories.media || embed.video || embed.image) {
        categories.media = true;
    }
    if (!isGif && !embeddedCategories.media && !embed.video && !embed.image) {
        categories.unknown = true;
    }
}

function analyzeMessage(message) {
    const categories = {
        gif: false,
        emoji: false,
        media: false,
        sticker: Boolean(message.stickers?.size),
        text: false,
        unknown: false
    };

    const content = typeof message.content === "string" ? message.content : "";
    if (content.trim()) {
        const urls = content.match(/https?:\/\/[^\s<>]+/gi) || [];
        let textContent = content;
        for (const url of urls) {
            if (addUrlCategory(url, categories)) {
                textContent = textContent.replace(url, " ");
            }
        }
        if (textContent.trim()) {
            const textAnalysis = analyzeText(textContent);
            categories.emoji = textAnalysis.containsEmoji;
            categories.text = textAnalysis.containsText;
        }
    }

    for (const attachment of message.attachments?.values?.() || []) {
        attachmentCategory(attachment, categories);
    }
    for (const embed of message.embeds || []) {
        embedCategory(embed, categories);
    }

    return categories;
}

module.exports = {
    analyzeMessage,
    isEmojiOnlyText
};
