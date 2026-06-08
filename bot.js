const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, AttachmentBuilder } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = "!roblox";

const ASSET_TYPE_NAMES = {
  1: "Image", 2: "T-Shirt", 3: "Audio", 4: "Mesh", 5: "Lua",
  6: "HTML", 7: "Text", 8: "Hat", 9: "Place", 10: "Model",
  11: "Shirt", 12: "Pants", 13: "Decal", 16: "Avatar", 17: "Head",
  18: "Face", 19: "Gear", 21: "Badge", 24: "Animation", 25: "Torso",
  26: "Right Arm", 27: "Left Arm", 28: "Left Leg", 29: "Right Leg",
  30: "Package", 31: "YouTubeVideo", 32: "GamePass", 34: "Plugin",
  38: "MeshPart", 40: "Hair Accessory", 41: "Face Accessory",
  42: "Neck Accessory", 43: "Shoulder Accessory", 44: "Front Accessory",
  45: "Back Accessory", 46: "Waist Accessory", 47: "ClimbAnimation",
  48: "DeathAnimation", 49: "FallAnimation", 50: "IdleAnimation",
  51: "JumpAnimation", 52: "RunAnimation", 53: "SwimAnimation",
  54: "WalkAnimation", 55: "PoseAnimation", 56: "LocalizationTable",
  57: "RobloxProduct", 61: "Hat Accessory", 62: "HairAccessory",
  64: "TShirtAccessory", 65: "ShirtAccessory", 66: "PantsAccessory",
  67: "JacketAccessory", 68: "SweaterAccessory", 69: "ShortsAccessory",
  70: "LeftShoeAccessory", 71: "RightShoeAccessory", 72: "DressSkirtAccessory",
  73: "FontFamily", 76: "EyebrowAccessory", 77: "EyelashAccessory",
  79: "MoodAnimation", 80: "DynamicHead",
};

const CLOTHING_TYPES = new Set([2, 11, 12]); // T-Shirt, Shirt, Pants
const DECAL_TYPE = 13;
const IMAGE_TYPE = 1;

// Roblox cookie for authenticated asset delivery
const ROBLOX_COOKIE = process.env.ROBLOX_COOKIE || null;

function getRobloxHeaders(wantImage = false) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": wantImage ? "image/*, */*" : "*/*",
  };
  if (ROBLOX_COOKIE) {
    headers["Cookie"] = `.ROBLOSECURITY=${ROBLOX_COOKIE}`;
  }
  return headers;
}

async function fetchAssetDetails(assetId) {
  const res = await fetch(`https://economy.roblox.com/v2/assets/${assetId}/details`);
  if (!res.ok) throw new Error(`Asset not found (HTTP ${res.status})`);
  return res.json();
}

async function fetchThumbnailAPI(assetId, size = "420x420") {
  try {
    const res = await fetch(
      `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=${size}&format=Png&isCircular=false`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const item = data?.data?.[0];
    if (!item || item.state !== "Completed" || !item.imageUrl) return null;
    return item.imageUrl;
  } catch { return null; }
}

// Extract the inner image ID from a Roblox clothing/decal XML file
// Uses www.roblox.com/asset/ which returns the actual XML
async function extractInnerImageId(assetId) {
  try {
    const res = await fetch(`https://www.roblox.com/asset/?id=${assetId}`, {
      headers: getRobloxHeaders(),
      redirect: "follow",
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";

    // If it came back as a direct image
    if (contentType.startsWith("image/")) {
      const buffer = Buffer.from(await res.arrayBuffer());
      return { type: "buffer", buffer, contentType };
    }

    const text = await res.text();

    // Match the <url> tag containing the inner image asset ID
    // Example: <url>http://www.roblox.com/asset/?id=1110654897</url>
    const urlTagMatch = text.match(/<url[^>]*>https?:\/\/[^<]*\/asset\/\?id=(\d+)[^<]*<\/url>/i);
    if (urlTagMatch) return { type: "id", id: urlTagMatch[1] };

    // Fallback patterns
    const patterns = [
      /https?:\/\/(?:www\.)?roblox\.com\/asset\/\?id=(\d+)/i,
      /rbxassetid:\/\/(\d+)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return { type: "id", id: match[1] };
    }

    return null;
  } catch (e) {
    console.error("extractInnerImageId error:", e.message);
    return null;
  }
}

// Fetch a raw image as a buffer from Roblox CDN
async function fetchImageBuffer(assetId) {
  try {
    const res = await fetch(`https://www.roblox.com/asset/?id=${assetId}`, {
      headers: getRobloxHeaders(true),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
  } catch { return null; }
}

async function fetchCreatorInfo(creatorType, creatorId) {
  try {
    if (creatorType === "User") {
      const res = await fetch(`https://users.roblox.com/v1/users/${creatorId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return { name: data.displayName || data.name, url: `https://www.roblox.com/users/${creatorId}/profile` };
    } else if (creatorType === "Group") {
      const res = await fetch(`https://groups.roblox.com/v1/groups/${creatorId}`);
      if (!res.ok) return null;
      const data = await res.json();
      return { name: data.name, url: `https://www.roblox.com/groups/${creatorId}` };
    }
  } catch { return null; }
  return null;
}

function formatDate(dateStr) {
  if (!dateStr) return "Unknown";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric"
  });
}

function getExtension(contentType) {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg";
  if (contentType?.includes("webp")) return "webp";
  return "png";
}

async function resolveImage(assetId, assetTypeId) {
  // CLOTHING (Shirt, Pants, T-Shirt) — XML file with inner texture image ID
  if (CLOTHING_TYPES.has(assetTypeId)) {
    const inner = await extractInnerImageId(assetId);
    if (inner?.type === "id") {
      // Fetch the actual texture PNG
      const imgBuf = await fetchImageBuffer(inner.id);
      if (imgBuf) return { type: "buffer", ...imgBuf };
      // Fallback: thumbnail of the texture image
      const thumb = await fetchThumbnailAPI(inner.id);
      if (thumb) return { type: "url", value: thumb };
    }
    if (inner?.type === "buffer") return { type: "buffer", ...inner };
    // Last resort: mannequin preview
    const thumb = await fetchThumbnailAPI(assetId);
    if (thumb) return { type: "url", value: thumb };
    return null;
  }

  // DECAL — XML file wrapping an image
  if (assetTypeId === DECAL_TYPE) {
    const inner = await extractInnerImageId(assetId);
    if (inner?.type === "id") {
      const imgBuf = await fetchImageBuffer(inner.id);
      if (imgBuf) return { type: "buffer", ...imgBuf };
      const thumb = await fetchThumbnailAPI(inner.id);
      if (thumb) return { type: "url", value: thumb };
    }
    if (inner?.type === "buffer") return { type: "buffer", ...inner };
    const thumb = await fetchThumbnailAPI(assetId);
    if (thumb) return { type: "url", value: thumb };
    return null;
  }

  // RAW IMAGE
  if (assetTypeId === IMAGE_TYPE) {
    const imgBuf = await fetchImageBuffer(assetId);
    if (imgBuf) return { type: "buffer", ...imgBuf };
    const thumb = await fetchThumbnailAPI(assetId);
    if (thumb) return { type: "url", value: thumb };
    return null;
  }

  // EVERYTHING ELSE — thumbnail preview
  const thumb = await fetchThumbnailAPI(assetId);
  if (thumb) return { type: "url", value: thumb };
  return null;
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity("Roblox Assets | !roblox <id>", { type: ActivityType.Watching });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  let assetId = null;

  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/\s+/);
    assetId = args[0];
  } else {
    return;
  }

  if (!assetId || !/^\d+$/.test(assetId)) {
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setTitle("❌ Invalid Usage")
          .setDescription(`Please provide a valid Roblox asset ID.\n\n**Usage:** \`${PREFIX} <asset_id>\`\n**Example:** \`${PREFIX} 6894586021\``)
          .setFooter({ text: "Roblox Asset Fetcher" })
      ]
    });
  }

  await message.channel.sendTyping();

  try {
    const details = await fetchAssetDetails(assetId);
    const assetTypeName = ASSET_TYPE_NAMES[details.AssetTypeId] || `Type ${details.AssetTypeId}`;
    const assetPageUrl = `https://www.roblox.com/catalog/${assetId}`;

    const creatorInfo = details.Creator
      ? await fetchCreatorInfo(details.Creator.CreatorType, details.Creator.CreatorTargetId)
      : null;

    const imageResult = await resolveImage(assetId, details.AssetTypeId);

    const embed = new EmbedBuilder()
      .setColor(0x00b2ff)
      .setTitle(details.Name || "Unknown Asset")
      .setURL(assetPageUrl)
      .setDescription(details.Description?.slice(0, 300) || "*No description provided.*")
      .addFields(
        { name: "🆔 Asset ID", value: `\`${assetId}\``, inline: true },
        { name: "📦 Type", value: assetTypeName, inline: true },
        { name: "💰 Price", value: details.IsForSale ? (details.PriceInRobux != null ? `R$ ${details.PriceInRobux}` : "Free") : "Not for sale", inline: true },
        { name: "👤 Creator", value: creatorInfo ? `[${creatorInfo.name}](${creatorInfo.url})` : (details.Creator?.Name || "Unknown"), inline: true },
        { name: "❤️ Favorites", value: details.Favorites?.toLocaleString() ?? "N/A", inline: true },
        { name: "📅 Created", value: formatDate(details.Created), inline: true },
        { name: "🔄 Updated", value: formatDate(details.Updated), inline: true },
        { name: "🔗 Asset Page", value: `[View on Roblox](${assetPageUrl})`, inline: true },
      )
      .setFooter({ text: `Roblox Asset Fetcher • Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL() })
      .setTimestamp();

    let files = [];

    if (imageResult) {
      if (imageResult.type === "url") {
        embed.setImage(imageResult.value);
      } else if (imageResult.type === "buffer") {
        const ext = getExtension(imageResult.contentType);
        const filename = `asset_${assetId}.${ext}`;
        const attachment = new AttachmentBuilder(imageResult.buffer, { name: filename });
        embed.setImage(`attachment://${filename}`);
        files.push(attachment);
      }
    } else {
      embed.addFields({
        name: "🖼️ Preview",
        value: "No preview available. This asset may be private or restricted.",
        inline: false
      });
    }

    await message.reply({ embeds: [embed], files });

  } catch (err) {
    console.error(`Error fetching asset ${assetId}:`, err);

    let errorMsg = "An unexpected error occurred.";
    if (err.message.includes("404") || err.message.includes("not found")) {
      errorMsg = `Asset ID \`${assetId}\` was not found. Make sure the ID is correct and the asset is public.`;
    } else if (err.message.includes("403")) {
      errorMsg = `Access denied for asset \`${assetId}\`. It may be private or restricted.`;
    }

    await message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff4444)
          .setTitle("❌ Error Fetching Asset")
          .setDescription(errorMsg)
          .addFields({ name: "Asset ID", value: `\`${assetId}\`` })
          .setFooter({ text: "Roblox Asset Fetcher" })
          .setTimestamp()
      ]
    });
  }
});

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ BOT_TOKEN environment variable is not set. Please set it before running the bot.");
  process.exit(1);
}
client.login(token);
