// =========================
// 設定・デフォルトテンプレ
// =========================

const TCH_DEFAULT_GLOBAL_SETTINGS = {
  extensionEnabled: true,
  autoSend: false,
  coolDownMs: 3000,
  position: null, // { left, top }
  activeMode: "regular"
};

// Mode definitions
const TCH_DEFAULTS_FIRST = [
  { id: "f-greet-1", text: "初見です！", categoryId: "greeting" },
  { id: "f-greet-2", text: "お邪魔します～", categoryId: "greeting" },
  { id: "f-greet-3", text: "おすすめから来ました！", categoryId: "greeting" },
  { id: "f-greet-4", text: "楽しそうですね！", categoryId: "greeting" },
  { id: "f-greet-5", text: "フォローしました！", categoryId: "greeting" },

  { id: "f-praise-1", text: "ナイスです！", categoryId: "praise" },
  { id: "f-praise-2", text: "888888", categoryId: "praise" },
  { id: "f-praise-3", text: "すごい！", categoryId: "praise" },
  { id: "f-praise-4", text: "上手ですね", categoryId: "praise" },
  { id: "f-praise-5", text: "感動", categoryId: "praise" },

  { id: "f-fun-1", text: "草", categoryId: "fun" },
  { id: "f-fun-2", text: "！？", categoryId: "fun" },
  { id: "f-fun-3", text: "勉強になります", categoryId: "fun" },
  { id: "f-fun-4", text: "なるほど", categoryId: "fun" },
  { id: "f-fun-5", text: "ありがとうございます", categoryId: "fun" }
];

const TCH_DEFAULTS_REGULAR = [
  { id: "r-greet-1", text: "おっす", categoryId: "greeting" },
  { id: "r-greet-2", text: "やっほー", categoryId: "greeting" },
  { id: "r-greet-3", text: "ども", categoryId: "greeting" },
  { id: "r-greet-4", text: "|ω・)ﾁﾗｯ", categoryId: "greeting" },
  { id: "r-greet-5", text: "おかえり", categoryId: "greeting" },

  { id: "r-praise-1", text: "ナイス！", categoryId: "praise" },
  { id: "r-praise-2", text: "GG", categoryId: "praise" },
  { id: "r-praise-3", text: "神", categoryId: "praise" },
  { id: "r-praise-4", text: "天才", categoryId: "praise" },
  { id: "r-praise-5", text: "つっよ", categoryId: "praise" },

  { id: "r-fun-1", text: "草", categoryId: "fun" },
  { id: "r-fun-2", text: "！？", categoryId: "fun" },
  { id: "r-fun-3", text: "わかる", categoryId: "fun" },
  { id: "r-fun-4", text: "たすかる", categoryId: "fun" },
  { id: "r-fun-5", text: "なるほど", categoryId: "fun" }
];

const TCH_DEFAULT_TEMPLATES = {
  first: TCH_DEFAULTS_FIRST,
  regular: TCH_DEFAULTS_REGULAR
};

const TCH_DEFAULT_CATEGORIES = {
  greeting: "挨拶",
  praise: "応援・称賛",
  fun: "リアクション"
};

const tchLastUsedMap = {};

function tchLog(...args) {
  console.log("[TCH]", ...args);
}

function tchLoadStorage(callback) {
  chrome.storage.sync.get(null, (data) => {
    const mergedGlobal = { ...TCH_DEFAULT_GLOBAL_SETTINGS, ...(data.globalSettings || {}) };

    // Logic similar to options.js: ensure first/regular exist
    // But data might still be old schema if options haven't been opened yet.
    let storedTemplates = data.templates || {};

    // Basic migration check (read-only migration for safe rendering)
    if (storedTemplates["*"] && !storedTemplates.regular) {
      storedTemplates.regular = storedTemplates["*"];
    }

    const templates = {
      first: storedTemplates.first || TCH_DEFAULT_TEMPLATES.first,
      regular: storedTemplates.regular || TCH_DEFAULT_TEMPLATES.regular
    };

    callback({ globalSettings: mergedGlobal, templates });
  });
}

function tchSaveGlobalSettings(patch) {
  chrome.storage.sync.get(null, (data) => {
    const current = { ...TCH_DEFAULT_GLOBAL_SETTINGS, ...(data.globalSettings || {}) };
    const newSettings = { ...current, ...patch };
    chrome.storage.sync.set({ globalSettings: newSettings });
  });
}

// ========== ユーティリティ ==========

function tchIsElVisible(el) {
  if (!el) return false;

  // 1. Basic Dimensions Check (Gold Standard for "Does it exist on screen")
  const rect = el.getBoundingClientRect();
  // Allow slightly smaller elements but ensure strictly positive area
  if (rect.width <= 0 || rect.height <= 0) return false;

  // 2. CSS Visibility Check (for display:none, visibility:hidden)
  const style = window.getComputedStyle(el);
  if (style.display === 'none') return false;
  if (style.visibility === 'hidden') return false;
  if (parseFloat(style.opacity) === 0) return false;

  return true;
}

function tchGetChannelName() {
  // Simple URL parsing: https://www.twitch.tv/channelName
  const path = window.location.pathname;
  const parts = path.split("/").filter(p => p);
  if (parts.length > 0) {
    if (parts[0] === "popout") return parts[1]; // popout/channel/chat
    return parts[0];
  }
  return null;
}

function tchRecordHistory() {
  try {
    const channel = tchGetChannelName();
    if (!channel) return;

    chrome.storage.sync.get("history", (data) => {
      if (chrome.runtime.lastError) return;

      const history = data.history || {};
      if (!history[channel]) {
        history[channel] = Date.now();
        chrome.storage.sync.set({ history });
        tchLog("History recorded for:", channel);
      }
    });

    // Also track user's own session messages
    // The event listener calls this after matching an Enter key or button click.
    // For manual interaction, we don't easily get the text content *after* send because the input clears.
    // So we should try to capture the input value *before* it clears? 
    // Or just hook into tchInsertTextToChat calls + keydown listeners.
    const input = tchFindChatInput();
    if (input) {
      // Approximate capture: if we are here, user likely sent what is currently in input (or just cleared)
      // Actually, for keydown 'Enter', the value is still there.
      // For button click, it might be tricky.
      // Let's rely on a helper that records the value.
      let text = "";
      if (input.tagName === "TEXTAREA") {
        text = input.value;
      } else {
        text = input.textContent; // contenteditable
      }
      if (text && text.trim()) {
        tchRecordUserExhaust(text.trim());
      }
    }

  } catch (e) {
    console.error("[TCH] History Record Error:", e);
  }
}

// ========== コンテキスト取得 (Scraping) ==========

const MAX_USER_HISTORY = 5;
let tchUserSessionHistory = [];

function tchRecordUserExhaust(text) {
  // Avoid duplicates if user spams?
  if (tchUserSessionHistory.length > 0 && tchUserSessionHistory[tchUserSessionHistory.length - 1] === text) {
    return;
  }
  tchUserSessionHistory.push(text);
  if (tchUserSessionHistory.length > MAX_USER_HISTORY) {
    tchUserSessionHistory.shift();
  }
  tchLog("Recorded user message:", text);
}

function tchGetStreamContext() {
  // 1. Title & Game (Category)
  // Selectors might change, but standard Twitch ones are usually stable enough for extension
  let title = "";
  let game = "";

  // Title
  // [data-a-target="stream-title"] is very common
  const titleEl = document.querySelector('[data-a-target="stream-title"]');
  if (titleEl) {
    title = titleEl.textContent;
  } else {
    // Fallback: document.title usually has "ChannelName - Twitch" or similar.
    // Or og:title meta tag
    title = document.title;
  }

  // Game/Category
  // [data-a-target="stream-game-link"] > span
  const gameEl = document.querySelector('[data-a-target="stream-game-link"] span, [data-a-target="video-info-game-name"]');
  if (gameEl) {
    game = gameEl.textContent;
  }

  // 2. Chat Log (Reduced to 20 for performance balance)
  const chatLines = [];
  const messages = document.querySelectorAll('[data-a-target="chat-line-message"]');
  const start = Math.max(0, messages.length - 20); // Get last 20
  for (let i = start; i < messages.length; i++) {
    const row = messages[i];
    const fragments = row.querySelectorAll('.text-fragment, [data-a-target="chat-message-text"]');
    let lineText = "";
    if (fragments.length > 0) {
      fragments.forEach(f => lineText += f.textContent);
    } else {
      lineText = row.textContent;
    }
    lineText = lineText.trim();
    if (lineText) chatLines.push(lineText);
  }

  // 3. Extended Metadata (Tags, Viewer Count, Display Name)

  // Viewer Count
  // [data-a-target="animated-channel-view-count"] is standard
  let viewerCount = "Unknown";
  const viewerEl = document.querySelector('[data-a-target="animated-channel-view-count"]');
  if (viewerEl) {
    viewerCount = viewerEl.textContent; // e.g., "1.2K", "500"
  }

  // Stream Tags
  // Usually in [data-a-target="stream-tags"] or links under title
  const tags = [];
  const tagEls = document.querySelectorAll('a[href*="/directory/all/tags/"]');
  tagEls.forEach(el => {
    const tagText = el.textContent.trim();
    if (tagText && !tags.includes(tagText)) {
      tags.push(tagText);
    }
  });

  // Channel Display Name (e.g. "SHAKA")
  let channelName = tchGetChannelName() || "Streamer"; // Default to ID if available

  // Selectors tried in order:
  // 1. Live channel user display name
  // 2. Headings
  // 3. Metadata tags
  const nameSelectors = [
    '[data-a-target="user-display-name"]',
    'h1.core-chevron-title',
    '.channel-info-content h1',
    '[data-test-selector="stream-info-card-component__display-name"]',
    '.home-header-sticky h1', // When sticky header is active
  ];

  for (const sel of nameSelectors) {
    const el = document.querySelector(sel);
    if (el && el.textContent.trim()) {
      channelName = el.textContent.trim();
      break;
    }
  }

  // If still "Streamer" (and ID wasn't found in URL?), try title fallback
  if (channelName === "Streamer") {
    // Attempt to grab from document title "Name - Twitch"
    const docTitle = document.title;
    const match = docTitle.match(/^(.+?) - Twitch$/);
    if (match) {
      channelName = match[1];
    }
  }

  return {
    title,
    game,
    tags,
    viewerCount,
    channelName,
    chatLogs: chatLines,
    userHistory: tchUserSessionHistory
  };
}

// ========== チャット入力欄の取得 ==========

function tchFindChatInput() {
  // Collect all potential candidates with broader selectors for responsive layouts
  const candidates = [
    // Standard Desktop
    ...document.querySelectorAll('textarea[data-a-target="chat-input"]'),
    ...document.querySelectorAll('[data-a-target="chat-input"][contenteditable="true"]'),
    ...document.querySelectorAll('[data-a-target="chat-input"] [contenteditable="true"]'),

    // Fallbacks for Narrow/Mobile/Alternative Layouts
    ...document.querySelectorAll('.chat-input__textarea textarea'),
    ...document.querySelectorAll('.chat-wysiwyg-input__editor'),
    ...document.querySelectorAll('[data-test-selector="chat-input"]'),
    ...document.querySelectorAll('textarea[placeholder*="メッセージを送信"]'), // Japanese locale specific fallback
    ...document.querySelectorAll('textarea[aria-label="チャット入力"]')      // Accessibility label fallback
  ];

  // Return the first one that is actually visible
  for (const el of candidates) {
    if (tchIsElVisible(el)) return el;
  }

  return null;
}


function tchInsertTextToChat(text) {
  const input = tchFindChatInput();
  if (!input) {
    tchLog("chat input not found");
    return;
  }

  if (input.tagName === "TEXTAREA") {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;
    nativeInputValueSetter.call(input, text);

    const event = new Event("input", { bubbles: true });
    input.dispatchEvent(event);
  } else {
    // contenteditable (Twitch/Slate)
    tchLog("Found chat input (contenteditable):", input);
    tchFocusCaret(input);

    try {
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      });
      const handled = !input.dispatchEvent(beforeInput);

      if (!handled) {
        const execResult = document.execCommand("insertText", false, text);
        tchLog("execCommand result:", execResult);
      }

      const inputEvent = new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: text,
        inputType: "insertText"
      });
      input.dispatchEvent(inputEvent);

      tchLog("Dispatched smart hybrid sequence for:", text);
    } catch (e) {
      tchLog("Insertion failed:", e);
    }
  }
}

function tchFocusCaret(el) {
  el.focus();
  let targetNode = el;
  while (targetNode.lastChild) {
    targetNode = targetNode.lastChild;
  }
  const range = document.createRange();
  if (targetNode.nodeType === Node.TEXT_NODE) {
    range.selectNodeContents(targetNode);
    range.collapse(false);
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function tchSendChat() {
  const input = tchFindChatInput();
  if (!input) return;

  const enterEvent = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });

  input.dispatchEvent(enterEvent);
}

// ========== パネル位置 ==========

function tchApplyPosition(root, globalSettings) {
  const pos = globalSettings.position;
  if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
    root.style.left = pos.left + "px";
    root.style.top = pos.top + "px";
    root.style.right = "auto";
  } else {
    root.style.right = "365px";
    root.style.top = "85px";
    root.style.left = "auto";
  }
}

function tchMakeDraggable(root) {
  const header = root.querySelector("#tch-panel-header");
  if (!header) return;

  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  function onMouseDown(e) {
    // Don't drag if clicking buttons inside header
    if (e.target.tagName === "BUTTON" || e.target.classList.contains("tch-mode-switch")) {
      return;
    }
    isDragging = true;
    const rect = root.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    let newLeft = startLeft + dx;
    let newTop = startTop + dy;

    const panelWidth = root.offsetWidth;
    const panelHeight = root.offsetHeight;

    const maxLeft = window.innerWidth - panelWidth - 4;
    const maxTop = window.innerHeight - panelHeight - 4;

    newLeft = Math.max(4, Math.min(maxLeft, newLeft));
    newTop = Math.max(4, Math.min(maxTop, newTop));

    root.style.left = newLeft + "px";
    root.style.top = newTop + "px";
    root.style.right = "auto";
  }

  function onMouseUp(e) {
    if (!isDragging) return;
    isDragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);

    const rect = root.getBoundingClientRect();
    const pos = { left: rect.left, top: rect.top };
    tchSaveGlobalSettings({ position: pos });
  }

  header.addEventListener("mousedown", onMouseDown);
}

// ========== パネル生成 ==========

function tchCreatePanelRoot(globalSettings) {
  if (document.getElementById("tch-panel-root")) {
    return document.getElementById("tch-panel-root");
  }

  const root = document.createElement("div");
  root.id = "tch-panel-root";

  const header = document.createElement("div");
  header.id = "tch-panel-header";

  // Title container
  const titleArea = document.createElement("div");
  titleArea.style.display = "flex";
  titleArea.style.alignItems = "center";
  titleArea.style.gap = "8px";

  const title = document.createElement("div");
  title.id = "tch-panel-title";
  title.textContent = "コメント";

  // Mode Switcher in Header
  const modeSwitch = document.createElement("button");
  modeSwitch.className = "tch-mode-switch";
  // Initial text set by render logic, but set default here
  modeSwitch.textContent = globalSettings.activeMode === "first" ? "🔰 初見" : "🔄 常連";

  titleArea.appendChild(title);
  titleArea.appendChild(modeSwitch);

  const toggle = document.createElement("div");
  toggle.id = "tch-panel-toggle";
  toggle.textContent = "−";
  toggle.addEventListener("click", () => {
    root.classList.toggle("tch-collapsed");
    toggle.textContent = root.classList.contains("tch-collapsed") ? "+" : "−";
  });

  header.appendChild(titleArea);
  header.appendChild(toggle);

  const tabs = document.createElement("div");
  tabs.id = "tch-tabs";

  const templatesContainer = document.createElement("div");
  templatesContainer.id = "tch-templates";

  const footer = document.createElement("div");
  footer.id = "tch-footer";

  const autoSendLabel = document.createElement("label");
  const autoSendCheckbox = document.createElement("input");
  autoSendCheckbox.type = "checkbox";
  autoSendCheckbox.id = "tch-autosend-checkbox";

  const autoSendText = document.createElement("span");
  autoSendText.textContent = "自動送信";

  autoSendLabel.appendChild(autoSendCheckbox);
  autoSendLabel.appendChild(autoSendText);

  const optsButton = document.createElement("button");
  optsButton.type = "button";
  optsButton.textContent = "設定";
  optsButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "TCH_OPEN_OPTIONS" });
  });

  footer.appendChild(autoSendLabel);
  footer.appendChild(optsButton);

  root.appendChild(header);
  root.appendChild(tabs);
  root.appendChild(templatesContainer);
  root.appendChild(footer);

  document.body.appendChild(root);

  tchApplyPosition(root, globalSettings);
  tchMakeDraggable(root);

  return root;
}

// ========== パネル中身 ==========

function tchBuildPanelContent(root, globalSettings, allTemplates, history) {
  const tabs = root.querySelector("#tch-tabs");
  const templatesContainer = root.querySelector("#tch-templates");
  const autoSendCheckbox = root.querySelector("#tch-autosend-checkbox");
  const modeSwitch = root.querySelector(".tch-mode-switch");

  // Logic for Auto-Mode
  const channel = tchGetChannelName();
  let currentMode = "regular"; // Default fallback

  // 1. If we have history for this channel, use 'regular'
  // 2. If NO history, use 'first'
  // 3. (Optional) If we want to respect last manual setting globally? 
  //    The user requirement is "Auto set based on situation". 
  //    So History overrides Global Setting for the *initial* state.

  if (channel && history && history[channel]) {
    currentMode = "regular";
  } else if (channel) {
    currentMode = "first";
  } else {
    // If we can't detect channel, fallback to last global setting or regular
    currentMode = globalSettings.activeMode || "regular";
  }

  // AutoSend
  autoSendCheckbox.checked = !!globalSettings.autoSend;
  autoSendCheckbox.addEventListener("change", (e) => {
    const checked = e.target.checked;
    tchSaveGlobalSettings({ autoSend: checked });
    globalSettings.autoSend = checked;
  });

  // Mode Switch Logic
  const updateModeUI = () => {
    modeSwitch.textContent = currentMode === "first" ? "🔰 初見" : "🔄 常連";
    modeSwitch.style.background = currentMode === "first" ? "#10b981" : "#6366f1";
    modeSwitch.style.color = "#fff";
    modeSwitch.style.border = "none";
    modeSwitch.style.borderRadius = "4px";
    modeSwitch.style.padding = "2px 6px";
    modeSwitch.style.fontSize = "10px";
    modeSwitch.style.cursor = "pointer";
    modeSwitch.style.fontWeight = "bold";

    const templatesForMode = allTemplates[currentMode] || [];
    renderTabsAndTemplates(templatesForMode);
  };

  modeSwitch.onclick = () => {
    currentMode = currentMode === "first" ? "regular" : "first";
    // We do NOT save this to globalSettings.activeMode anymore 
    // because we want the AUTO logic to take precedence on next load?
    // Or maybe we save it as a "preference override"? 
    // For now, let's just change local state. 
    // If user reloads, it re-evaluates history. This is safer for "first time" logic.
    updateModeUI();
  };

  // Render Core
  const renderTabsAndTemplates = (templatesList) => {
    // 1. Extract unique categories from this list
    const categories = [];
    templatesList.forEach((tpl) => {
      if (!categories.includes(tpl.categoryId)) {
        categories.push(tpl.categoryId);
      }
    });

    // Add Recommended if API Key is present and valid string
    const hasApiKey = globalSettings.groqApiKey && typeof globalSettings.groqApiKey === 'string' && globalSettings.groqApiKey.trim().length > 0;

    // TCH_DEFAULT_CATEGORIES.recommended was set in tchInit if key exists, but double check here.
    if (hasApiKey && TCH_DEFAULT_CATEGORIES.recommended && !categories.includes("recommended")) {
      categories.push("recommended");
    }

    if (categories.length === 0) {
      tabs.innerHTML = "";
      templatesContainer.textContent = "設定がありません";
      return;
    }

    // If Recommended exists, make it the default active category
    if (categories.includes("recommended")) {
      activeCategory = "recommended";
    } else {
      activeCategory = categories[0];
    }

    // Render Tabs
    tabs.innerHTML = "";
    categories.forEach((catId) => {
      const tabEl = document.createElement("div");
      tabEl.className = "tch-tab";
      if (catId === activeCategory) {
        tabEl.classList.add("tch-tab-active");
      }
      tabEl.textContent = TCH_DEFAULT_CATEGORIES[catId] || catId;
      tabEl.dataset.categoryId = catId;

      tabEl.addEventListener("click", async () => {
        activeCategory = catId;
        tabs.querySelectorAll(".tch-tab").forEach((t) => {
          t.classList.toggle(
            "tch-tab-active",
            t.dataset.categoryId === activeCategory
          );
        });

        if (catId === "recommended") {
          // AI Flow
          await renderAIForRecommended();
        } else {
          renderButtons(templatesList, activeCategory);
        }
      });
      tabs.appendChild(tabEl);
    });

    // Initial render of buttons
    if (activeCategory === "recommended") {
      renderAIForRecommended();
    } else {
      renderButtons(templatesList, activeCategory);
    }

    async function renderAIForRecommended(isAuto = false) {
      // 1. Setup Container Layout (Header + Content) if not already structured
      // We need to re-render header every time to capture state (or just update text?)
      // Simplest approach: Re-render all, but keep structure clear.

      templatesContainer.innerHTML = "";

      // --- HEADER START ---
      const headerArea = document.createElement("div");
      headerArea.style.display = "flex";
      headerArea.style.justifyContent = "space-between";
      headerArea.style.alignItems = "center";
      headerArea.style.marginBottom = "8px";
      headerArea.style.borderBottom = "1px solid #e0e7ff";
      headerArea.style.paddingBottom = "4px";

      const statusText = document.createElement("span");
      statusText.style.fontSize = "10px";
      statusText.style.color = "#888";

      // Status Text Logic
      if (document.getElementById("tch-loading-indicator")) {
        statusText.textContent = "生成中...";
      } else {
        statusText.textContent = "AIおすすめ (自動更新中)";
      }

      const refreshBtn = document.createElement("button");
      refreshBtn.textContent = "手動更新 (高品質)";
      refreshBtn.style.padding = "2px 8px";
      refreshBtn.style.fontSize = "10px";
      refreshBtn.style.cursor = "pointer";
      refreshBtn.style.background = "#4f46e5";
      refreshBtn.style.color = "#fff";
      refreshBtn.style.border = "none";
      refreshBtn.style.borderRadius = "4px";

      refreshBtn.addEventListener("click", () => {
        renderAIForRecommended(false); // Manual trigger (High Quality)
      });

      headerArea.appendChild(statusText);
      headerArea.appendChild(refreshBtn);
      templatesContainer.appendChild(headerArea);
      // --- HEADER END ---

      // Content Container
      const contentArea = document.createElement("div");
      contentArea.id = "tch-ai-content";
      templatesContainer.appendChild(contentArea);

      // Loading State Display
      if (!isAuto) {
        contentArea.textContent = "AI生成中...";
        statusText.textContent = "生成中... (高品質)";
      } else {
        // Auto-refresh in background? 
        // If we want to show loading for auto, uncomment:
        // contentArea.textContent = "更新中...";
      }

      const apiKey = globalSettings.groqApiKey;
      if (!apiKey) {
        contentArea.textContent = "APIキーが設定されていません";
        return;
      }

      const context = tchGetStreamContext();
      context.isFirstTime = (currentMode === "first");

      const result = await tchGenerateAIComments(apiKey, context, isAuto);

      if (!result) {
        contentArea.innerHTML = "<span style='color:#ef4444'>エラーが発生しました。<br>通信エラー</span>";
        return;
      }

      if (!result.success) {
        if (result.error === 'RATE_LIMIT') {
          const retrySec = result.retryAfter || 60;

          if (isAuto) {
            // Logic for Auto Pause
            if (window.tchAutoRefreshTimer) {
              clearInterval(window.tchAutoRefreshTimer);
              window.tchAutoRefreshTimer = null;
            }
            // Retry logic...
            setTimeout(() => {
              if (activeCategory === "recommended") {
                // Re-setup interval
                window.tchAutoRefreshTimer = setInterval(() => {
                  const panel = document.getElementById("tch-panel-root");
                  if (panel && panel.style.display !== "none" && activeCategory === "recommended") {
                    renderAIForRecommended(true);
                  }
                }, 180000);
              }
            }, retrySec * 1000);

            // Should we show error in auto mode? Maybe just status
            statusText.textContent = `レート制限中 (次回:${retrySec}s)`;
          } else {
            contentArea.innerHTML = `<span style='color:#f59e0b'>レート制限 (${retrySec}秒待ち)</span>`;
          }
          return;
        }

        contentArea.innerHTML = `<span style='color:#ef4444'>エラー: ${result.error}</span>`;
        return;
      }

      const suggestions = result.data;

      if (suggestions.length === 0) {
        contentArea.textContent = "生成結果なし";
        return;
      }

      // Render Suggestions
      contentArea.innerHTML = ""; // Clear loading/old
      const listContainer = document.createElement("div");
      listContainer.style.display = "flex";
      listContainer.style.flexDirection = "column";
      listContainer.style.gap = "4px";

      suggestions.forEach((text, idx) => {
        const btn = document.createElement("button");
        btn.className = "tch-template-btn";
        btn.textContent = text;
        btn.style.border = "1px solid #a5b4fc";

        btn.addEventListener("click", () => {
          const now = Date.now();
          if (now - (tchLastUsedMap["ai-last"] || 0) < (globalSettings.coolDownMs || 0)) return;
          tchLastUsedMap["ai-last"] = now;

          tchInsertTextToChat(text);
          if (globalSettings.autoSend) {
            tchSendChat();
            tchRecordHistory();
          }
        });
        listContainer.appendChild(btn);
      });
      contentArea.appendChild(listContainer);

      // Update Status Normal
      statusText.textContent = isAuto ? "自動更新済み" : "生成完了";
    }

    // Auto-Update Logic (Timer)
    // Clear any existing timer to avoid duplicates on re-render
    clearInterval(window.tchAutoRefreshTimer);
    window.tchAutoRefreshTimer = null;

    // Only set timer if Recommended is active
    if (activeCategory === "recommended") {
      window.tchAutoRefreshTimer = setInterval(() => {
        // Double check visibility and activity
        const panel = document.getElementById("tch-panel-root");
        if (panel && panel.style.display !== "none" && activeCategory === "recommended") {
          renderAIForRecommended(true);
        }
      }, 180000); // 3 minutes (180,000 ms)
    }

    function renderButtons(list, catId) {
      templatesContainer.innerHTML = "";
      const filtered = list.filter(t => t.categoryId === catId);

      if (filtered.length === 0) {
        templatesContainer.textContent = "（空）";
        return;
      }

      // Enforce stricter 5-item limit as requested
      const validItems = filtered.slice(0, 5);

      validItems.forEach((tpl) => {
        const btn = document.createElement("button");
        btn.className = "tch-template-btn";
        btn.textContent = tpl.text;

        btn.addEventListener("click", () => {
          const now = Date.now();
          const lastUsed = tchLastUsedMap[tpl.id] || 0;
          if (now - lastUsed < (globalSettings.coolDownMs || 0)) {
            return;
          }
          tchLastUsedMap[tpl.id] = now;

          tchInsertTextToChat(tpl.text);

          // RECORD HISTORY Only on AutoSend or Manual Send (via global listeners)
          if (globalSettings.autoSend) {
            tchSendChat();
            tchRecordHistory();
          }
        });

        templatesContainer.appendChild(btn);
      });
    };
  }

  // Initial call
  updateModeUI();
}

// ========== 初期化 ==========

function tchInit() {
  try {
    chrome.storage.sync.get(null, (data) => {
      if (chrome.runtime.lastError) {
        console.error("[TCH] Storage Error:", chrome.runtime.lastError);
        return;
      }

      const globalSettings = { ...TCH_DEFAULT_GLOBAL_SETTINGS, ...(data.globalSettings || {}) };

      // Master Switch Check
      if (globalSettings.extensionEnabled === false) {
        tchLog("Extension is disabled via settings.");
        const existing = document.getElementById("tch-panel-root");
        if (existing) existing.remove();
        return; // Stop initialization
      }

      let storedTemplates = data.templates || {};
      if (storedTemplates["*"] && !storedTemplates.regular) {
        storedTemplates.regular = storedTemplates["*"];
      }

      // Load History
      const history = data.history || {};

      // Helper to validate and default
      const getOrDef = (arr, def) => {
        if (!Array.isArray(arr) || arr.length === 0) return def;
        const valid = arr.filter(t => t && t.text && t.categoryId);
        if (valid.length === 0) return def;
        return valid;
      };

      const templates = {
        first: getOrDef(storedTemplates.first, TCH_DEFAULT_TEMPLATES.first),
        regular: getOrDef(storedTemplates.regular, TCH_DEFAULT_TEMPLATES.regular)
      };

      // Add "recommended" if API Key exists and is valid string
      if (globalSettings.groqApiKey && typeof globalSettings.groqApiKey === 'string' && globalSettings.groqApiKey.trim().length > 0) {
        TCH_DEFAULT_CATEGORIES.recommended = "おすすめ（AI）";
      } else {
        // Ensure it's not there
        delete TCH_DEFAULT_CATEGORIES.recommended;
      }

      const safeTemplates = JSON.parse(JSON.stringify(templates));
      const safeHistory = JSON.parse(JSON.stringify(history));

      tchLog("Initialized with templates:", safeTemplates);
      tchLog("Current History:", safeHistory);
      tchLog("Detected Channel:", tchGetChannelName());
      tchLog("API Key Present:", !!(globalSettings.groqApiKey && globalSettings.groqApiKey.trim().length > 0));

      const root = tchCreatePanelRoot(globalSettings);
      tchBuildPanelContent(root, globalSettings, templates, history);
    });
  } catch (e) {
    console.error("[TCH] Context Invalidated or Init Error:", e);
    // ... error handling
    const warn = document.createElement("div");
    warn.style.position = "fixed";
    warn.style.top = "10px";
    warn.style.left = "50%";
    warn.style.transform = "translateX(-50%)";
    warn.style.background = "#ef4444";
    warn.style.color = "white";
    warn.style.padding = "10px 20px";
    warn.style.borderRadius = "8px";
    warn.style.zIndex = "2147483647";
    warn.style.fontWeight = "bold";
    warn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
    warn.textContent = "拡張機能が更新されました。ページを再読み込みしてください。";
    document.body.appendChild(warn);
  }
}

// ========== Navigation Handling (SPA) ==========
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    tchLog("URL changed to:", url);
    // Debounce re-init to allow DOM to settle
    setTimeout(() => {
      // Re-run initialization to decide First/Regular mode and bind to new DOM if needed
      // We can just call tchInit() again? 
      // tchInit removes existing panel if detected in storage listener, but maybe we should explicitly clear it here?
      const existing = document.getElementById("tch-panel-root");
      if (existing) existing.remove();
      tchInit();
    }, 1000); // Wait 1 sec for Twitch DOM to swap
  }
}).observe(document.body, { childList: true, subtree: true });

// Initial call
tchInit();

async function tchGenerateAIComments(apiKey, context, isAuto = false) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "TCH_GENERATE_AI",
        apiKey: apiKey,
        context: context,
        isAuto: isAuto
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("[TCH] Runtime Error:", chrome.runtime.lastError);
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      }
    );
  });
}

// Watchdog to handle SPA navigation or DOM wiping
let lastChannel = null;

setInterval(() => {
  const currentChannel = tchGetChannelName();

  // 1. Check if channel changed (SPA navigation)
  if (currentChannel && lastChannel && currentChannel !== lastChannel) {
    tchLog("Channel changed, resetting panel...");
    const existing = document.getElementById("tch-panel-root");
    if (existing) existing.remove();
    lastChannel = currentChannel;
    tchInit();
    return;
  }

  // 2. Check if panel is missing (DOM wiped)
  if (!document.getElementById("tch-panel-root")) {
    tchLog("Panel missing, re-initializing...");
    lastChannel = currentChannel; // Update lastChannel to current
    tchInit();
  } else {
    // 3. Toggle visibility based on chat existence AND visibility
    const panel = document.getElementById("tch-panel-root");
    const chatInput = tchFindChatInput();

    // Check if input is technically visible (has size)
    const isVisible = (el) => {
      if (!el) return false;

      // 1. Size Check (Ignore 0x0 or tiny ghost elements)
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return false;

      // 2. Modern Browser Visibility Check
      if (el.checkVisibility) {
        return el.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true
        });
      }

      // Fallback
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
    };

    const isInputVisible = isVisible(chatInput);

    if (isInputVisible) {
      if (panel.style.display === "none") panel.style.display = "flex";
    } else {
      if (panel.style.display !== "none") panel.style.display = "none";
    }
  }
}, 1000);

// Global listeners for manual interaction (history recording)
document.addEventListener("keydown", (e) => {
  // Enter key on chat input (ignore IME composition and Shift+Enter)
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    const target = e.target;
    // Check if looking at chat input
    if (target.matches && (target.matches('[data-a-target="chat-input"]') || target.closest('[data-a-target="chat-input"]'))) {
      tchLog("Manual chat detected (Enter)");
      tchRecordHistory();
    }
  }
}, true); // Capture phase

document.addEventListener("click", (e) => {
  // Click on chat send button
  if (e.target.closest && e.target.closest('[data-a-target="chat-send-button"]')) {
    tchLog("Manual chat detected (Send Button)");
    tchRecordHistory();
  }
}, true);

// Dynamic Settings Update Listener
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync') {
    if (changes.globalSettings || changes.templates) {
      tchLog("Settings changed, re-initializing panel...");

      // Remove existing panel
      const existing = document.getElementById("tch-panel-root");
      if (existing) existing.remove();

      // Clear any running AI timer
      if (window.tchAutoRefreshTimer) {
        clearInterval(window.tchAutoRefreshTimer);
        window.tchAutoRefreshTimer = null;
      }

      // Re-initialize with new settings
      tchInit();
    }
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    lastChannel = tchGetChannelName();
    try {
      tchInit();
    } catch (e) {
      console.error("[TCH] Init Error:", e);
    }
  });
} else {
  lastChannel = tchGetChannelName();
  try {
    tchInit();
  } catch (e) {
    console.error("[TCH] Init Error:", e);
  }
}