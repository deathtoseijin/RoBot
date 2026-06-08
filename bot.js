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

// Clothing types that wrap a texture image inside XML
const CLOTHING_TYPES = new Set([2, 11, 12]); // T-Shirt, Shirt, Pants
// Decal type also wraps an image
const DECAL_TYPE = 13;
// Raw image type
const IMAGE_TYPE = 1;

async function fetchAssetDetails(assetId) {
  const res = await fetch(`https://economy.roblox.com/v2/assets/${assetId}/details`);
  if (!res.ok) throw new Error(`Asset not found (HTTP ${res.status})`);
  return res.json();
}

// Fetch the mannequin/preview thumbnail (for accessories, hats, gear etc.)
async function fetchThumbnailAPI(assetId, size = "420x420") {
  const res = await fetch(
    `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=${size}&format=Png&isCircular=false`
  );
  if (!res.ok) return null;
  const data = await res.json();
  const item = data?.data?.[0];
  if (!item || item.state !== "Completed" || !item.imageUrl) return null;
  return item.imageUrl;
}

// Fetch the raw asset file and parse the inner image ID from XML (for shirts, pants, decals)
async function fetchInnerImageIdFromAsset(assetId) {
  try {
    const res = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${assetId}`, {
      headers: {
        "User-Agent": "RobloxStudio/WinInet",
        "Accept": "*/*",
      }
    });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";

    // If it's a direct image, return the URL
    if (contentType.startsWith("image/")) {
      const buffer = Buffer.from(await res.arrayBuffer());
      return { type: "buffer", buffer, contentType };
    }

    // If it's XML (clothing/decal asset file), parse the inner image ID
    const text = await res.text();

    // Patterns found in Roblox XML asset files
    const patterns = [
      /https?:\/\/(?:www\.)?roblox\.com\/asset\/\?id=(\d+)/i,
      /<url>.*?\/asset\/\?id=(\d+).*?<\/url>/i,
      /rbxassetid:\/\/(\d+)/i,
      /ShirtTemplate.*?\/asset\/\?id=(\d+)/i,
      /PantsTemplate.*?\/asset\/\?id=(\d+)/i,
      /Texture.*?\/asset\/\?id=(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return { type: "id", id: match[1] };
    }

    return null;
  } catch (e) {
    console.error("fetchInnerImageIdFromAsset error:", e.message);
    return null;
  }
}

// Fetch an image buffer from a Roblox asset ID (must be a raw image type)
async function fetchImageBuffer(assetId) {
  try {
    const res = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${assetId}`, {
      headers: { "User-Agent": "RobloxStudio/WinInet" }
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
  } catch {
    return null;
  }
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

// Main image resolution — tries different strategies based on asset type
async function resolveImage(assetId, assetTypeId) {

  // CLOTHING (Shirt, Pants, T-Shirt) — fetch the XML file and get the inner texture image
  if (CLOTHING_TYPES.has(assetTypeId)) {
    const inner = await fetchInnerImageIdFromAsset(assetId);
    if (inner) {
      if (inner.type === "id") {
        // Try to get the actual texture image
        const imgBuffer = await fetchImageBuffer(inner.id);
        if (imgBuffer) return { type: "buffer", ...imgBuffer, label: "texture" };
        // Fallback: thumbnail of inner image
        const thumb = await fetchThumbnailAPI(inner.id);
        if (thumb) return { type: "url", value: thumb, label: "texture" };
      }
      if (inner.type === "buffer") return { type: "buffer", ...inner, label: "texture" };
    }
    // Last resort: mannequin thumbnail
    const thumb = await fetchThumbnailAPI(assetId);
    if (thumb) return { type: "url", value: thumb, label: "preview" };
    return null;
  }

  // DECAL — wraps an image in XML, extract inner image
  if (assetTypeId === DECAL_TYPE) {
    const inner = await fetchInnerImageIdFromAsset(assetId);
    if (inner?.type === "id") {
      const imgBuffer = await fetchImageBuffer(inner.id);
      if (imgBuffer) return { type: "buffer", ...imgBuffer, label: "decal" };
      const thumb = await fetchThumbnailAPI(inner.id);
      if (thumb) return { type: "url", value: thumb, label: "decal" };
    }
    const thumb = await fetchThumbnailAPI(assetId);
    if (thumb) return { type: "url", value: thumb, label: "preview" };
    return null;
  }

  // RAW IMAGE — try direct delivery first
  if (assetTypeId === IMAGE_TYPE) {
    const imgBuffer = await fetchImageBuffer(assetId);
    if (imgBuffer) return { type: "buffer", ...imgBuffer, label: "image" };
    // Some images are accessible via thumbnail API
    const thumb = await fetchThumbnailAPI(assetId);
    if (thumb) return { type: "url", value: thumb, label: "image" };
    return null;
  }

  // EVERYTHING ELSE (accessories, badges, gamepasses, hats, etc.) — use thumbnail API
  const thumb = await fetchThumbnailAPI(assetId);
  if (thumb) return { type: "url", value: thumb, label: "preview" };

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
        value: "No preview available. This asset may be private or not publicly accessible.",
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
 
