const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const PREFIX = "!roblox"; // Change this to whatever prefix you prefer

// Fetch asset details from Roblox API
async function fetchAssetDetails(assetId) {
  const res = await fetch(`https://economy.roblox.com/v2/assets/${assetId}/details`);
  if (!res.ok) throw new Error(`Asset not found (HTTP ${res.status})`);
  return res.json();
}

// Fetch thumbnail/image URL for an asset
async function fetchAssetThumbnail(assetId) {
  const res = await fetch(
    `https://thumbnails.roblox.com/v1/assets?assetIds=${assetId}&size=420x420&format=Png&isCircular=false`
  );
  if (!res.ok) throw new Error(`Thumbnail fetch failed (HTTP ${res.status})`);
  const data = await res.json();
  const item = data?.data?.[0];
  if (!item || item.state !== "Completed") return null;
  return item.imageUrl;
}

// Fetch creator info (user or group)
async function fetchCreatorInfo(creatorType, creatorId) {
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
  return null;
}

// Map asset type IDs to readable names
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

function formatDate(dateStr) {
  if (!dateStr) return "Unknown";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric"
  });
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setActivity("Roblox Assets | !roblox <id>", { type: ActivityType.Watching });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();

  // Check for prefix command or just a bare Roblox asset ID
  let assetId = null;

  if (content.startsWith(PREFIX)) {
    const args = content.slice(PREFIX.length).trim().split(/\s+/);
    assetId = args[0];
  } else {
    // Also respond to just a number if it looks like a Roblox ID (optional - remove if too aggressive)
    // Uncomment the lines below if you want the bot to respond to bare IDs too
    // if (/^\d{6,}$/.test(content)) {
    //   assetId = content;
    // }
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

  // Show typing indicator while fetching
  await message.channel.sendTyping();

  try {
    const [details, thumbnailUrl] = await Promise.all([
      fetchAssetDetails(assetId),
      fetchAssetThumbnail(assetId),
    ]);

    const assetTypeName = ASSET_TYPE_NAMES[details.AssetTypeId] || `Type ${details.AssetTypeId}`;
    const assetPageUrl = `https://www.roblox.com/catalog/${assetId}`;

    // Fetch creator info
    let creatorInfo = null;
    if (details.Creator) {
      creatorInfo = await fetchCreatorInfo(details.Creator.CreatorType, details.Creator.CreatorTargetId);
    }

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

    if (thumbnailUrl) {
      embed.setImage(thumbnailUrl);
      embed.setThumbnail("https://images.rbxcdn.com/b18b35d5898b1891b0ba4a84d36c9e57-roblox-logo.png");
    } else {
      embed.addFields({ name: "🖼️ Preview", value: "No preview available for this asset type.", inline: false });
    }

    await message.reply({ embeds: [embed] });

  } catch (err) {
    console.error(`Error fetching asset ${assetId}:`, err);

    let errorMsg = "An unexpected error occurred.";
    if (err.message.includes("404") || err.message.includes("not found")) {
      errorMsg = `Asset ID \`${assetId}\` was not found. Make sure the ID is correct and the asset is publicly visible.`;
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

// Login — token is read from environment variable BOT_TOKEN
const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("❌ BOT_TOKEN environment variable is not set. Please set it before running the bot.");
  process.exit(1);
}
client.login(token);
