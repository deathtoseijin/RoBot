const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, AttachmentBuilder } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = "!roblox";

// Asset types that are visual (can show an image)
const VISUAL_ASSET_TYPES = new Set([1, 2, 8, 11, 12, 13, 17, 18, 19, 21, 32, 38,
  40, 41, 42, 43, 44, 45, 46, 61, 62, 64, 65, 66, 67, 68, 69, 70, 71, 72, 76, 77, 80]);

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

async function fetchAssetDetails(assetId) {
  const res = await fetch(`https://economy.roblox.com/v2/assets/${assetId}/details`);
  if (!res.ok) throw new Error(`Asset not found (HTTP ${res.status})`);
  return res.json();
}

// Strategy 1: thumbnails API (works for catalog items, accessories, etc.)
async function fetchThumbnailAPI(assetId) {
  const res = await fetch(
    `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=420x420&format=Png&isCircular=false`
  );
  if (!res.ok) return null;
  const data = await res.json();
  const item = data?.data?.[0];
  if (!item || item.state !== "Completed" || !item.imageUrl) return null;
  return item.imageUrl;
}

// Strategy 2: asset delivery API — works for raw images/decals uploaded to Roblox
async function fetchAssetDeliveryURL(assetId) {
  // This redirects to the actual CDN file URL
  const res = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${assetId}`, {
    redirect: "follow",
    headers: { "User-Agent": "Roblox/WinInet" }
  });
  if (!res.ok) return null;

  // The final URL after redirect is the CDN image URL
  const finalUrl = res.url;
  const contentType = res.headers.get("content-type") || "";

  // Only return if it's actually an image
  if (contentType.startsWith("image/")) {
    return { url: finalUrl, buffer: Buffer.from(await res.arrayBuffer()), contentType };
  }

  // For XML/RBXM assets (models, decals wrapping an image), try to extract image ID
  if (contentType.includes("xml") || contentType.includes("text")) {
    const text = await res.text().catch(() => null);
    if (text) {
      // Decals contain a reference to an image asset ID inside XML
      const match = text.match(/http[s]?:\/\/www\.roblox\.com\/asset\/\?id=(\d+)/i)
                 || text.match(/<url>.*?\/asset\/\?id=(\d+)<\/url>/i)
                 || text.match(/rbxassetid:\/\/(\d+)/i);
      if (match) {
        return { redirectId: match[1] };
      }
    }
  }

  return null;
}

// Strategy 3: game thumbnails endpoint (works for some assets)
async function fetchGameThumbnail(assetId) {
  const res = await fetch(
    `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=768x432&format=Png`
  );
  if (!res.ok) return null;
  const data = await res.json();
  const item = data?.data?.[0];
  if (!item || item.state !== "Completed" || !item.imageUrl) return null;
  return item.imageUrl;
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

async function resolveImage(assetId, assetTypeId) {
  // Try thumbnail API first (fastest)
  const thumb = await fetchThumbnailAPI(assetId);
  if (thumb) return { type: "url", value: thumb };

  // Try asset delivery (for raw images, decals)
  try {
    const delivery = await fetchAssetDeliveryURL(assetId);
    if (delivery) {
      // If it redirected to another asset ID (e.g. decal → image)
      if (delivery.redirectId) {
        const innerThumb = await fetchThumbnailAPI(delivery.redirectId);
        if (innerThumb) return { type: "url", value: innerThumb };

        // Try delivery on the inner ID too
        const innerDelivery = await fetchAssetDeliveryURL(delivery.redirectId);
        if (innerDelivery?.buffer) {
          return { type: "buffer", value: innerDelivery.buffer, contentType: innerDelivery.contentType };
        }
      }
      // Direct image buffer
      if (delivery.buffer) {
        return { type: "buffer", value: delivery.buffer, contentType: delivery.contentType };
      }
    }
  } catch (e) {
    console.error("Asset delivery error:", e.message);
  }

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

    // Try to resolve an image through all strategies
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
        // Determine extension from content type
        const ext = imageResult.contentType?.includes("png") ? "png"
                  : imageResult.contentType?.includes("jpeg") ? "jpg"
                  : imageResult.contentType?.includes("webp") ? "webp"
                  : "png";
        const attachment = new AttachmentBuilder(imageResult.value, { name: `asset_${assetId}.${ext}` });
        embed.setImage(`attachment://asset_${assetId}.${ext}`);
        files.push(attachment);
      }
    } else {
      embed.addFields({ name: "🖼️ Preview", value: "No preview available for this asset.", inline: false });
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
