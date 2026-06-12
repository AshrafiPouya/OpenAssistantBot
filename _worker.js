/**
 * ===========================================================================
 *  AI Telegram Bot — Serverless on Cloudflare Workers
 * ===========================================================================
 *  A single-file Telegram chatbot powered by OpenRouter's free AI models.
 *  Runs entirely on Cloudflare's free tier. No build step, no CLI.
 *
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  SETUP (about 3 minutes, all in the browser):                        │
 *  │  1. Cloudflare → Workers & Pages → KV → create namespace "BOT_DB"    │
 *  │  2. Create a Worker, click "Edit code", paste THIS file, Deploy      │
 *  │  3. Worker → Settings → Bindings → add KV binding:                   │
 *  │       Variable name: BOT_DB   →   your BOT_DB namespace              │
 *  │  4. Open  https://<your-worker>.workers.dev/setup  and fill the form │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 *  Everything else (Telegram token, OpenRouter key, model choice) is set
 *  through the /setup web page and saved in KV — no code editing needed.
 * ===========================================================================
 */

// ── Default free model list (top by usage, June 2026) ──────────────────────
// Editable later from the /setup dashboard. IDs ending in :free are free.
const DEFAULT_MODELS = [
  { id: "openrouter/owl-alpha", label: "Owl Alpha (1M ctx)" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super 120B" },
  { id: "poolside/laguna-m.1:free", label: "Laguna M.1 (coding)" },
  { id: "openai/gpt-oss-120b:free", label: "GPT-OSS 120B" },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra 550B" },
  { id: "z-ai/glm-4.5-air:free", label: "GLM 4.5 Air" },
  { id: "poolside/laguna-xs.2:free", label: "Laguna XS.2 (coding)" },
  { id: "openai/gpt-oss-20b:free", label: "GPT-OSS 20B" },
  { id: "nvidia/nemotron-3-nano-30b-a3b:free", label: "Nemotron 3 Nano 30B" },
  { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B" },
];

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant chatting with a user on Telegram. " +
  "Keep answers concise and use plain text.";

const HISTORY_LIMIT = 10;   // past messages kept per user
const TG_CHUNK = 4000;      // Telegram caps messages at 4096 chars

// ===========================================================================
//  Worker entry point
// ===========================================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Guard: KV must be bound
    if (!env.BOT_DB) {
      return html(setupErrorPage("KV namespace 'BOT_DB' is not bound. " +
        "Go to Worker → Settings → Bindings and add it."), 500);
    }

    const cfg = await loadConfig(env);

    // --- Setup dashboard (GET shows form, POST saves) ---
    if (url.pathname === "/setup") {
      if (request.method === "POST") return await saveSetup(request, env);
      return html(setupPage(cfg, url));
    }

    // --- Telegram webhook ---
    if (request.method === "POST" && url.pathname === "/webhook") {
      if (!cfg.configured) return new Response("not configured", { status: 503 });
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secret !== cfg.webhookSecret) return new Response("forbidden", { status: 403 });

      const update = await request.json();
      ctx.waitUntil(handleUpdate(update, env, cfg).catch((e) => console.error(e)));
      return new Response("ok");
    }

    // --- One-click webhook registration (visit once after setup) ---
    if (url.pathname === "/register" && cfg.configured) {
      const workerUrl = `${url.protocol}//${url.host}/webhook`;
      const r = await fetch(
        `https://api.telegram.org/bot${cfg.telegramToken}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: workerUrl, secret_token: cfg.webhookSecret }),
        }
      );
      const data = await r.json();
      return html(resultPage(data.ok
        ? "✅ Webhook registered! Open your bot in Telegram and send /start."
        : "❌ Failed: " + JSON.stringify(data)));
    }

    // --- Landing page ---
    return html(landingPage(cfg, url));
  },
};

// ===========================================================================
//  Config (stored in KV under a single key)
// ===========================================================================
async function loadConfig(env) {
  const raw = await env.BOT_DB.get("config");
  const c = raw ? JSON.parse(raw) : {};
  return {
    configured: !!(c.telegramToken && c.openrouterKey),
    telegramToken: c.telegramToken || "",
    openrouterKey: c.openrouterKey || "",
    webhookSecret: c.webhookSecret || "",
    systemPrompt: c.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    models: c.models && c.models.length ? c.models : DEFAULT_MODELS,
    adminPassword: c.adminPassword || "admin",
  };
}

async function saveSetup(request, env) {
  const form = await request.formData();
  const cfg = await loadConfig(env);

  // Simple password gate so randoms can't overwrite your config
  if ((form.get("password") || "") !== cfg.adminPassword) {
    return html(resultPage("❌ Wrong admin password."));
  }

  const modelsText = (form.get("models") || "").trim();
  const models = modelsText
    ? modelsText.split("\n").map((line) => {
        const id = line.trim();
        return { id, label: id };
      }).filter((m) => m.id)
    : cfg.models;

  const next = {
    telegramToken: (form.get("telegramToken") || "").trim(),
    openrouterKey: (form.get("openrouterKey") || "").trim(),
    webhookSecret: (form.get("webhookSecret") || "").trim() || crypto.randomUUID(),
    systemPrompt: (form.get("systemPrompt") || "").trim() || DEFAULT_SYSTEM_PROMPT,
    adminPassword: (form.get("newPassword") || "").trim() || cfg.adminPassword,
    models,
  };

  await env.BOT_DB.put("config", JSON.stringify(next));
  return html(resultPage(
    "✅ Saved! Next step: <a href='/register'>click here to register the Telegram webhook</a>, " +
    "then message your bot."));
}

// ===========================================================================
//  Telegram update handling
// ===========================================================================
async function handleUpdate(update, env, cfg) {
  if (update.callback_query) return handleCallback(update.callback_query, env, cfg);

  const msg = update.message;
  if (!msg || !msg.text || !msg.from) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();

  if (text.startsWith("/start")) {
    return sendMessage(cfg, chatId,
      "👋 Hi! I'm an AI bot running on Cloudflare Workers + OpenRouter free models.\n\n" +
      "Just send me a message.\n\n/model – choose AI model\n/clear – clear history\n/help");
  }
  if (text.startsWith("/help")) {
    return sendMessage(cfg, chatId, "Send any message to chat.\n/model – choose model\n/clear – clear history");
  }
  if (text.startsWith("/clear")) {
    await env.BOT_DB.delete(`hist:${userId}`);
    return sendMessage(cfg, chatId, "🧹 History cleared.");
  }
  if (text.startsWith("/model")) {
    const current = await getUserModel(env, cfg, userId);
    return tg(cfg, "sendMessage", {
      chat_id: chatId,
      text: `Current model: ${current}\n\nPick a model:`,
      reply_markup: {
        inline_keyboard: cfg.models.map((m, i) => [{ text: m.label, callback_data: `m:${i}` }]),
      },
    });
  }

  // Regular chat → LLM
  await tg(cfg, "sendChatAction", { chat_id: chatId, action: "typing" });

  const model = await getUserModel(env, cfg, userId);
  const history = await getHistory(env, userId);
  const messages = [
    { role: "system", content: cfg.systemPrompt },
    ...history,
    { role: "user", content: text },
  ];

  const result = await chatWithFallback(cfg, model, messages);
  if (!result.ok) {
    return sendMessage(cfg, chatId,
      "⚠️ All free models are rate-limited or unavailable. Try again in a minute.");
  }

  await saveHistory(env, userId, history, text, result.reply);
  const suffix = result.modelUsed !== model ? `\n\n(fallback: ${result.modelUsed})` : "";
  return sendMessage(cfg, chatId, result.reply + suffix);
}

async function handleCallback(cb, env, cfg) {
  const data = cb.data || "";
  if (data.startsWith("m:")) {
    const i = parseInt(data.slice(2), 10);
    const model = cfg.models[i];
    if (model) {
      await env.BOT_DB.put(`model:${cb.from.id}`, model.id);
      await tg(cfg, "answerCallbackQuery", { callback_query_id: cb.id, text: "Saved ✅" });
      if (cb.message) {
        await tg(cfg, "editMessageText", {
          chat_id: cb.message.chat.id,
          message_id: cb.message.message_id,
          text: `✅ Model set to: ${model.label}\n(${model.id})`,
        });
      }
      return;
    }
  }
  await tg(cfg, "answerCallbackQuery", { callback_query_id: cb.id });
}

// ===========================================================================
//  Storage helpers (KV)
// ===========================================================================
async function getUserModel(env, cfg, userId) {
  return (await env.BOT_DB.get(`model:${userId}`)) || cfg.models[0].id;
}

async function getHistory(env, userId) {
  const raw = await env.BOT_DB.get(`hist:${userId}`);
  return raw ? JSON.parse(raw) : [];
}

async function saveHistory(env, userId, history, userText, assistantText) {
  const next = [...history,
    { role: "user", content: userText },
    { role: "assistant", content: assistantText },
  ].slice(-HISTORY_LIMIT);
  await env.BOT_DB.put(`hist:${userId}`, JSON.stringify(next));
}

// ===========================================================================
//  OpenRouter (with automatic fallback)
// ===========================================================================
async function chatWithFallback(cfg, preferred, messages) {
  const ids = cfg.models.map((m) => m.id);
  const chain = [preferred, ...ids.filter((id) => id !== preferred)];

  for (const model of chain) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.openrouterKey}`,
          "Content-Type": "application/json",
          "X-Title": "AI Telegram Bot",
        },
        body: JSON.stringify({ model, messages, max_tokens: 1024 }),
      });
      if ([429, 502, 503].includes(res.status)) continue;
      if (!res.ok) { console.error(`${model} HTTP ${res.status}`); continue; }
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim();
      if (reply) return { ok: true, reply, modelUsed: model };
    } catch (e) { console.error(`${model} failed`, e); }
  }
  return { ok: false };
}

// ===========================================================================
//  Telegram API helpers
// ===========================================================================
async function tg(cfg, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${cfg.telegramToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) console.error(`TG ${method} HTTP ${r.status}: ${await r.text()}`);
}

async function sendMessage(cfg, chatId, text) {
  for (let i = 0; i < text.length; i += TG_CHUNK) {
    await tg(cfg, "sendMessage", { chat_id: chatId, text: text.slice(i, i + TG_CHUNK) });
  }
}

// ===========================================================================
//  Web UI (embedded — no external assets)
// ===========================================================================
function html(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const STYLE = `
  :root{--bg:#0f1419;--card:#1a2027;--accent:#f38020;--text:#e6edf3;--muted:#8b949e;--border:#2d333b}
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
  .wrap{max-width:640px;margin:0 auto;padding:32px 20px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:28px;margin-bottom:20px}
  h1{margin:0 0 4px;font-size:24px}
  h2{font-size:17px;margin:24px 0 8px}
  .sub{color:var(--muted);margin:0 0 24px}
  label{display:block;font-weight:600;margin:16px 0 6px;font-size:14px}
  .hint{color:var(--muted);font-size:12px;font-weight:400;margin-top:2px}
  input,textarea{width:100%;padding:11px 13px;background:var(--bg);border:1px solid var(--border);border-radius:9px;color:var(--text);font-size:14px;font-family:inherit}
  input:focus,textarea:focus{outline:none;border-color:var(--accent)}
  textarea{resize:vertical;min-height:90px;font-family:ui-monospace,monospace;font-size:13px}
  button{margin-top:24px;width:100%;padding:13px;background:var(--accent);color:#fff;border:0;border-radius:9px;font-size:15px;font-weight:700;cursor:pointer}
  button:hover{opacity:.92}
  a{color:var(--accent)}
  .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700}
  .ok{background:#1f3a1f;color:#7ee787}.warn{background:#3a2f1f;color:#f0c674}
  code{background:var(--bg);padding:2px 6px;border-radius:5px;font-size:13px}
  ol{padding-left:20px}ol li{margin:6px 0}
`;

function shell(inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AI Telegram Bot</title><style>${STYLE}</style></head>
  <body><div class="wrap">${inner}</div></body></html>`;
}

function landingPage(cfg, url) {
  const status = cfg.configured
    ? `<span class="badge ok">● Configured</span>`
    : `<span class="badge warn">● Not configured yet</span>`;
  return shell(`
    <div class="card">
      <h1>🤖 AI Telegram Bot</h1>
      <p class="sub">Serverless on Cloudflare Workers + OpenRouter free models</p>
      ${status}
      <h2>Get started</h2>
      <ol>
        <li>Open the <a href="/setup">Setup page</a> and enter your tokens</li>
        <li>Click <b>Register webhook</b> when prompted</li>
        <li>Message your bot on Telegram</li>
      </ol>
      <p class="hint">This page lives at <code>${url.host}</code>. Bookmark <a href="/setup">/setup</a> to change settings later.</p>
    </div>`);
}

function setupPage(cfg, url) {
  const modelLines = cfg.models.map((m) => m.id).join("\n");
  return shell(`
    <div class="card">
      <h1>⚙️ Setup</h1>
      <p class="sub">Saved securely in your Cloudflare KV. Leave the password fields' defaults if unsure.</p>
      <form method="POST" action="/setup">
        <label>Admin password
          <div class="hint">Default is <code>admin</code>. Change it below after first save.</div>
        </label>
        <input name="password" type="password" placeholder="admin" required>

        <h2>Required</h2>
        <label>Telegram Bot Token
          <div class="hint">From @BotFather → /newbot</div>
        </label>
        <input name="telegramToken" value="${esc(cfg.telegramToken)}" placeholder="123456:ABC-DEF...">

        <label>OpenRouter API Key
          <div class="hint">From openrouter.ai → Keys. Free models work with $0 balance.</div>
        </label>
        <input name="openrouterKey" value="${esc(cfg.openrouterKey)}" placeholder="sk-or-v1-...">

        <h2>Optional</h2>
        <label>Webhook secret
          <div class="hint">Leave blank to auto-generate a secure random one.</div>
        </label>
        <input name="webhookSecret" value="${esc(cfg.webhookSecret)}" placeholder="(auto)">

        <label>System prompt (bot personality)</label>
        <textarea name="systemPrompt" rows="3">${esc(cfg.systemPrompt)}</textarea>

        <label>Model list (one OpenRouter model ID per line, first = default)
          <div class="hint">Find free models at openrouter.ai/collections/free-models</div>
        </label>
        <textarea name="models" rows="8">${esc(modelLines)}</textarea>

        <label>New admin password (optional)</label>
        <input name="newPassword" type="password" placeholder="(leave blank to keep current)">

        <button type="submit">💾 Save configuration</button>
      </form>
    </div>`);
}

function resultPage(message) {
  return shell(`<div class="card"><h1>${message}</h1><p style="margin-top:20px"><a href="/setup">← Back to setup</a></p></div>`);
}

function setupErrorPage(message) {
  return shell(`<div class="card"><h1>⚠️ Setup needed</h1><p>${esc(message)}</p></div>`);
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
