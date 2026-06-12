# 🤖 AI Telegram Bot

### A serverless Telegram chatbot on Cloudflare Workers

A secure, lightweight AI chatbot that runs **entirely on Cloudflare's free tier**.
Powered by [OpenRouter](https://openrouter.ai)'s top free AI models, with a built-in
web dashboard for setup — no terminal, no CLI, no build step.

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)
![Cost](https://img.shields.io/badge/Cost-%240%2Fmonth-0A66C2?style=for-the-badge)

---

## 🌟 Why this bot?

- ⚡ **Zero server cost** — runs on Cloudflare's Free Tier. No VPS, no maintenance.
- 📋 **Copy-paste deploy** — one `_worker.js` file. Paste it into the dashboard. Done.
- 🎨 **Web setup dashboard** — configure tokens and settings in your browser, not in code.
- 🤖 **10 free AI models** — switch any time with `/model`, automatic fallback on rate limits.
- 💾 **Persists in KV** — your settings survive code updates.
- 💬 **Remembers context** — multi-turn conversations per user.

## ✨ Features

| Feature | Description |
| --- | --- |
| **🔀 Model switcher** | `/model` shows an inline keyboard of the top 10 free OpenRouter models |
| **♻️ Auto-fallback** | If a model is rate-limited (429), the next one is tried automatically |
| **🧠 Memory** | Remembers the last 10 messages per user (`/clear` to wipe) |
| **🔐 Protected webhook** | Secret-token check so only Telegram can reach your bot |
| **🎛️ Web dashboard** | Change tokens, system prompt, and model list at `/setup` |
| **✂️ Long replies** | Auto-splits messages over Telegram's 4096-char limit |

## 🚀 Quick Start

Get your bot running in about **3 minutes**, entirely in the browser.

### 1. Create a KV Namespace

1. Go to **Cloudflare Dashboard** → **Workers & Pages** → **KV**.
2. Click **Create a namespace**, name it `BOT_DB`.

### 2. Deploy the Worker

1. Go to **Workers & Pages** → **Create Application** → **Create Worker**.
2. Name it (e.g. `ai-bot`) and click **Deploy**.
3. Click **Edit code**, delete the sample, paste the contents of
   [`_worker.js`](./_worker.js), and click **Deploy**.

### 3. Bind the storage

1. Go to your Worker → **Settings** → **Bindings** (or **Variables**).
2. Add a **KV Namespace Binding**:
   - **Variable name:** `BOT_DB`
   - **KV namespace:** select the `BOT_DB` you created.
3. **Save and Deploy**.

### 4. Configure & connect

1. Open `https://<your-worker>.workers.dev/setup`.
2. Enter:
   - **Telegram Bot Token** — from [@BotFather](https://t.me/BotFather) (`/newbot`)
   - **OpenRouter API Key** — from [openrouter.ai/keys](https://openrouter.ai/keys) (free, no card)
3. Click **Save configuration**, then click the **Register webhook** link.
4. Open your bot in Telegram and send `/start`. 🎉

> **⚠️ Tip:** Change the default admin password (`admin`) in the setup form
> right after your first save, so nobody else can edit your config.

## 🎛️ Managing your bot

Everything is changed from the web dashboard — no code edits needed:

- **`/setup`** — update tokens, system prompt (personality), or the model list
- **`/register`** — re-register the Telegram webhook (e.g. after changing the secret)
- **`/`** — status page showing whether the bot is configured

In Telegram:

- **`/model`** — pick which free AI model answers you
- **`/clear`** — wipe your conversation history
- **`/help`** — show commands

## 📊 Free-tier limits

| Layer | Free limit | Meaning |
| --- | --- | --- |
| Cloudflare Workers | 100,000 req/day | Effectively unlimited for a personal bot |
| Cloudflare KV | 100,000 writes/day, 1,000 lists | Plenty for chat history |
| OpenRouter free models | ~20 req/min, ~50–200 req/day | **Your real bottleneck** |

If you outgrow OpenRouter's free daily cap, a one-time **$10** credit
(never expires) raises the free-model daily limit to ~1000 requests.

## 🔧 Customization

The model list and personality are editable from `/setup` — but you can also
change defaults at the top of `_worker.js`:

- `DEFAULT_MODELS` — the model list and order
- `DEFAULT_SYSTEM_PROMPT` — the bot's personality
- `HISTORY_LIMIT` — how many past messages to remember

Free model IDs (ending in `:free`) change over time — see the current list at
[openrouter.ai/collections/free-models](https://openrouter.ai/collections/free-models).

## 🛠️ Troubleshooting

- **Bot doesn't reply** → check the Worker's **Logs** (real-time) in the dashboard,
  and verify the webhook at
  `https://api.telegram.org/bot<TOKEN>/getWebhookInfo`
- **"Setup needed" page** → the `BOT_DB` KV binding is missing (step 3)
- **403 in logs** → webhook secret mismatch; re-run **Register webhook** from `/setup`
- **"All free models rate-limited"** → you hit OpenRouter's daily free quota; wait
  for reset or add the one-time $10 credit

## 📄 License

MIT — fork it, ship it, make it yours.
