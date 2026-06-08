# 🎮 Roblox Asset Discord Bot

A Discord bot that fetches Roblox asset/image previews by ID and embeds them in your server.

## ✨ Features
- Fetches asset name, description, type, price, creator, favorites, and dates
- Pulls the asset **thumbnail/image** and embeds it
- Handles 80+ Roblox asset types (hats, shirts, decals, models, badges, gamepasses, etc.)
- Clean error messages for invalid or private assets

## 📦 Setup

### 1. Install Node.js
Make sure you have **Node.js 18+** installed: https://nodejs.org

### 2. Install dependencies
```bash
npm install
```

### 3. Create a Discord Bot
1. Go to https://discord.com/developers/applications
2. Click **New Application** → name it
3. Go to **Bot** tab → click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - ✅ **Message Content Intent**
5. Copy your **Bot Token**

### 4. Invite the Bot to Your Server
In the **OAuth2 → URL Generator**:
- Scopes: `bot`
- Bot Permissions: `Send Messages`, `Embed Links`, `Read Message History`

Copy the generated URL and open it in your browser.

### 5. Set Your Bot Token

**Option A — Environment variable (recommended):**
```bash
# Linux / macOS
export BOT_TOKEN=your_token_here
node bot.js

# Windows (Command Prompt)
set BOT_TOKEN=your_token_here
node bot.js

# Windows (PowerShell)
$env:BOT_TOKEN="your_token_here"
node bot.js
```

**Option B — .env file:**
Create a `.env` file:
```
BOT_TOKEN=your_token_here
```
Then install dotenv: `npm install dotenv`
And add this line to the TOP of `bot.js`:
```js
require("dotenv").config();
```

### 6. Start the Bot
```bash
npm start
```

## 🎯 Usage

In any Discord channel the bot has access to:

```
!roblox <asset_id>
```

**Examples:**
```
!roblox 1365767
!roblox 6894586021
!roblox 102611803
```

## ⚙️ Configuration

Open `bot.js` and change the `PREFIX` at the top:
```js
const PREFIX = "!roblox"; // Change to whatever you like, e.g. "!rb" or "?asset"
```

## 📝 Notes
- Only **public** assets can be fetched. Private assets will return an error.
- Some asset types (Audio, Lua scripts) may not have a visual thumbnail.
- The bot uses the official Roblox public APIs — no API key required.
