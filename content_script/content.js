// =========================
// 設定・デフォルトテンプレ
// =========================

const TCH_DEFAULT_GLOBAL_SETTINGS = {
  autoSend: false,
  coolDownMs: 3000,
  position: null // { left, top }
};

const TCH_DEFAULT_TEMPLATES = {
  "*": [
    { id: "greet-1", text: "初見です！よろしくお願いします", categoryId: "greeting" },
    { id: "greet-2", text: "おつです！今日も来ました", categoryId: "greeting" },
    { id: "praise-1", text: "ナイス！", categoryId: "praise" },
    { id: "praise-2", text: "GG！", categoryId: "praise" },
    { id: "fun-1", text: "それは草", categoryId: "fun" },
    { id: "fun-2", text: "今日も安定の沼w", categoryId: "fun" }
  ]
};

const TCH_DEFAULT_CATEGORIES = {
  greeting: "挨拶",
  praise: "ナイス・GG",
  fun: "ツッコミ・ネタ"
};

const tchLastUsedMap = {};

function tchLog(...args) {
  console.log("[TCH]", ...args);
}

function tchGetChannelId() {
  const host = window.location.host;
  const pathParts = window.location.pathname.split("/").filter(Boolean);

  if (host === "www.twitch.tv" && pathParts.length === 1) {
    return pathParts[0];
  }

  return "*";
}

function tchLoadStorage(callback) {
  chrome.storage.sync.get(null, (data) => {
    const mergedGlobal = { ...TCH_DEFAULT_GLOBAL_SETTINGS, ...(data.globalSettings || {}) };
    const templates =
      data.templates && Object.keys(data.templates).length > 0
        ? data.templates
        : { ...TCH_DEFAULT_TEMPLATES };

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

// ========== チャット入力欄の取得 ==========

function tchFindChatInput() {
  // 1. 昔の textarea スタイル
  let el = document.querySelector('textarea[data-a-target="chat-input"]');
  if (el) return el;

  // 2. data-a-target="chat-input" を持つ contenteditable
  el = document.querySelector('[data-a-target="chat-input"][contenteditable="true"]');
  if (el) return el;

  // 3. コンテナの中の contenteditable
  const container = document.querySelector('[data-a-target="chat-input"]');
  if (container) {
    el = container.querySelector('[contenteditable="true"]');
    if (el) return el;
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

    // 1. カーソル位置を確実にセットする (Selection補正)
    tchFocusCaret(input);

    try {
      // Smart Hybrid Strategy:
      // エディタの機嫌を損ねずにテキストを挿入する

      // A. beforeinput を「お伺い」として投げる
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: text
      });
      const handled = !input.dispatchEvent(beforeInput);
      tchLog("beforeinput handled:", handled);

      // B. エディタが beforeinput を無視した場合のみ、強制的に書き込む (execCommand)
      //    Twitch(Slate)が正しく実装されていれば beforeinput をpreventDefaultするはずだが、
      //    しない場合は標準APIに頼る
      if (!handled) {
        const execResult = document.execCommand("insertText", false, text);
        tchLog("execCommand result:", execResult);
      }

      // C. inputイベント (念のための同期)
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

// カーソルを要素の末尾（テキストノードの中）にセットする関数
function tchFocusCaret(el) {
  el.focus();

  // 最深部のテキストノードを見つける
  let targetNode = el;
  while (targetNode.lastChild) {
    targetNode = targetNode.lastChild;
  }

  // Selectionを作成
  const range = document.createRange();
  if (targetNode.nodeType === Node.TEXT_NODE) {
    range.selectNodeContents(targetNode);
    range.collapse(false); // 末尾
  } else {
    range.selectNodeContents(el);
    range.collapse(false);
  }

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  tchLog("Focused caret at:", targetNode);
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
    // デフォルト位置：チャット欄(右側340px程度)の左隣、上部
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

  const title = document.createElement("div");
  title.id = "tch-panel-title";
  title.textContent = "コメントテンプレ";

  const toggle = document.createElement("div");
  toggle.id = "tch-panel-toggle";
  toggle.textContent = "−";
  toggle.addEventListener("click", () => {
    root.classList.toggle("tch-collapsed");
    toggle.textContent = root.classList.contains("tch-collapsed") ? "+" : "−";
  });

  header.appendChild(title);
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
  autoSendText.textContent = "クリックで自動送信";

  autoSendLabel.appendChild(autoSendCheckbox);
  autoSendLabel.appendChild(autoSendText);

  const optsButton = document.createElement("button");
  optsButton.type = "button";
  optsButton.textContent = "設定を開く";
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

function tchBuildTabsAndButtons(root, globalSettings, templatesForChannel) {
  const tabs = root.querySelector("#tch-tabs");
  const templatesContainer = root.querySelector("#tch-templates");
  const autoSendCheckbox = root.querySelector("#tch-autosend-checkbox");

  autoSendCheckbox.checked = !!globalSettings.autoSend;
  autoSendCheckbox.addEventListener("change", (e) => {
    const checked = e.target.checked;
    tchSaveGlobalSettings({ autoSend: checked });
  });

  const categories = [];
  templatesForChannel.forEach((tpl) => {
    if (!categories.includes(tpl.categoryId)) {
      categories.push(tpl.categoryId);
    }
  });
  if (categories.length === 0) {
    templatesContainer.textContent = "テンプレが設定されていません。";
    return;
  }

  let activeCategory = categories[0];

  tabs.innerHTML = "";
  categories.forEach((catId) => {
    const tabEl = document.createElement("div");
    tabEl.className = "tch-tab";
    if (catId === activeCategory) {
      tabEl.classList.add("tch-tab-active");
    }
    tabEl.textContent = TCH_DEFAULT_CATEGORIES[catId] || catId;
    tabEl.dataset.categoryId = catId;
    tabEl.addEventListener("click", () => {
      activeCategory = catId;
      tabs.querySelectorAll(".tch-tab").forEach((t) => {
        t.classList.toggle(
          "tch-tab-active",
          t.dataset.categoryId === activeCategory
        );
      });
      tchRenderButtons(
        templatesContainer,
        templatesForChannel,
        activeCategory,
        globalSettings
      );
    });
    tabs.appendChild(tabEl);
  });

  tchRenderButtons(
    templatesContainer,
    templatesForChannel,
    activeCategory,
    globalSettings
  );
}

function tchRenderButtons(
  templatesContainer,
  templatesForChannel,
  activeCategory,
  globalSettings
) {
  templatesContainer.innerHTML = "";

  const filtered = templatesForChannel.filter(
    (tpl) => tpl.categoryId === activeCategory
  );

  if (filtered.length === 0) {
    const msg = document.createElement("div");
    msg.textContent = "このカテゴリにはテンプレがありません。";
    templatesContainer.appendChild(msg);
    return;
  }

  filtered.forEach((tpl) => {
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

      if (globalSettings.autoSend) {
        tchSendChat();
      }
    });

    templatesContainer.appendChild(btn);
  });
}

// ========== 初期化 ==========

function tchInit() {
  const channelId = tchGetChannelId();
  tchLoadStorage(({ globalSettings, templates }) => {
    const channelTemplates =
      (templates[channelId] && templates[channelId].length > 0)
        ? templates[channelId]
        : (templates["*"] || TCH_DEFAULT_TEMPLATES["*"]);

    const root = tchCreatePanelRoot(globalSettings);
    tchBuildTabsAndButtons(root, globalSettings, channelTemplates);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", tchInit);
} else {
  tchInit();
}