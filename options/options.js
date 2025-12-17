const DEFAULT_GLOBAL_SETTINGS = {
  extensionEnabled: true,
  autoSend: false,
  coolDownMs: 3000,
  position: null,
  activeMode: "regular", // 'regular' (default/migrated) or 'first'
  aiSendChatLogs: false
};

const FIXED_CATEGORIES = ["greeting", "praise", "fun"];
const SLOT_LIMIT = 5;

// Default templates for "First-time" (初見)
const DEFAULTS_FIRST = [
  { id: "f-greet-1", text: "初見です！", categoryId: "greeting" },
  { id: "f-greet-2", text: "初見失礼します！", categoryId: "greeting" },
  { id: "f-greet-3", text: "お邪魔します！", categoryId: "greeting" },
  { id: "f-greet-4", text: "こんばんは！", categoryId: "greeting" },
  { id: "f-greet-5", text: "おすすめから来ました！", categoryId: "greeting" },

  { id: "f-praise-1", text: "ナイス！", categoryId: "praise" },
  { id: "f-praise-2", text: "うま！", categoryId: "praise" },
  { id: "f-praise-3", text: "つよw", categoryId: "praise" },
  { id: "f-praise-4", text: "GG", categoryId: "praise" },
  { id: "f-praise-5", text: "888888", categoryId: "praise" },

  { id: "f-fun-1", text: "草", categoryId: "fun" },
  { id: "f-fun-2", text: "！？", categoryId: "fun" },
  { id: "f-fun-3", text: "えぐw", categoryId: "fun" },
  { id: "f-fun-4", text: "うおお", categoryId: "fun" },
  { id: "f-fun-5", text: "まじかw", categoryId: "fun" }
];

// Default templates for "Regular" (常連)
const DEFAULTS_REGULAR = [
  { id: "r-greet-1", text: "こん", categoryId: "greeting" },
  { id: "r-greet-2", text: "こんちゃ", categoryId: "greeting" },
  { id: "r-greet-3", text: "こんばんは", categoryId: "greeting" },
  { id: "r-greet-4", text: "おは", categoryId: "greeting" },
  { id: "r-greet-5", text: "ただいま", categoryId: "greeting" },

  { id: "r-praise-1", text: "ナイス！", categoryId: "praise" },
  { id: "r-praise-2", text: "うま！", categoryId: "praise" },
  { id: "r-praise-3", text: "つよw", categoryId: "praise" },
  { id: "r-praise-4", text: "GG", categoryId: "praise" },
  { id: "r-praise-5", text: "888888", categoryId: "praise" },

  { id: "r-fun-1", text: "草", categoryId: "fun" },
  { id: "r-fun-2", text: "！？", categoryId: "fun" },
  { id: "r-fun-3", text: "えぐw", categoryId: "fun" },
  { id: "r-fun-4", text: "うおお", categoryId: "fun" },
  { id: "r-fun-5", text: "声出たw", categoryId: "fun" }
];

// In-memory state to hold unsaved changes
let workingTemplates = {
  first: [],
  regular: []
};

let currentMode = "regular";

function $(id) {
  return document.getElementById(id);
}

function showStatus(message, isError = false) {
  const statusEl = $("status");
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#f97373" : "#22c55e";
  if (message) {
    setTimeout(() => {
      statusEl.textContent = "";
    }, 2500);
  }
}

function loadAllFromStorage(callback) {
  chrome.storage.sync.get(null, (data) => {
    const globalSettings =
      { ...DEFAULT_GLOBAL_SETTINGS, ...(data.globalSettings || {}) };

    // Migration Logic: if we have "templates['*']", move it to "regular"
    let storedTemplates = data.templates || {};

    if (storedTemplates["*"]) {
      // Migrate legacy/single-mode data to regular
      storedTemplates.regular = storedTemplates["*"];
      delete storedTemplates["*"];
      // We will perform a silent save later or just let the next simple save handle it.
      // But for now, just map it in memory.
    }

    // Ensure implementation of both keys
    const finalTemplates = {
      first: (storedTemplates.first && storedTemplates.first.length > 0)
        ? storedTemplates.first
        : JSON.parse(JSON.stringify(DEFAULTS_FIRST)),
      regular: (storedTemplates.regular && storedTemplates.regular.length > 0)
        ? storedTemplates.regular
        : JSON.parse(JSON.stringify(DEFAULTS_REGULAR))
    };

    callback({ globalSettings, templates: finalTemplates });
  });
}

function saveAllToStorage(globalSettings, templates, callback) {
  // We save the structure schema as:
  // templates: { first: [...], regular: [...] }
  chrome.storage.sync.set(
    {
      globalSettings,
      templates
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        showStatus("保存に失敗しました。", true);
      } else {
        showStatus("保存しました。");
        if (callback) callback();
      }
    }
  );
}

// Render the inputs based on the CURRENT mode's data in workingTemplates
function renderCurrentMode() {
  const templatesForMode = workingTemplates[currentMode] || [];

  FIXED_CATEGORIES.forEach(catId => {
    const container = $(`group-${catId}`);
    if (!container) return;
    container.innerHTML = "";

    // Filter
    const catTemplates = templatesForMode.filter(t => t.categoryId === catId);

    for (let i = 0; i < SLOT_LIMIT; i++) {
      const tpl = catTemplates[i] || { text: "", id: null };

      const wrapper = document.createElement("div");
      wrapper.className = "input-row";

      const input = document.createElement("input");
      input.type = "text";
      input.value = tpl.text;
      input.placeholder = `メッセージ ${i + 1}`;
      input.dataset.category = catId;
      input.dataset.index = i.toString();

      // On input, update workingTemplates instantly
      input.addEventListener("input", (e) => {
        updateWorkingState(catId, i, e.target.value);
      });

      wrapper.appendChild(input);
      container.appendChild(wrapper);
    }
  });

  // Update tabs visual state
  $("mode-btn-first").classList.toggle("mode-active", currentMode === "first");
  $("mode-btn-regular").classList.toggle("mode-active", currentMode === "regular");
}

function updateWorkingState(catId, index, value) {
  const list = workingTemplates[currentMode];
  // We need to find the correct item in the flat list corresponding to (catId, index)
  // But strictly speaking, the list is flat. 
  // Easier approach: Re-gather EVERYTHING from the list for this category, update it, and reconstruct the flat list?
  // No, that's heavy.
  // Better: workingTemplates[currentMode] is the source of truth.
  // We need to map (catId, visual_index_0_to_4) -> actual array item.

  // Strategy: The workingTemplates list might contain gaps or be out of order.
  // Let's filter by category to find the 'existing' ones.
  const catItems = list.filter(t => t.categoryId === catId);

  // If we are editing the i-th item of this category:
  if (index < catItems.length) {
    // Modify existing
    catItems[index].text = value;
    // We need to reflect this back to the main list. 
    // Since objects are references, if catItems[index] is a ref to an obj in list, we are good.
    // YES, filter returns a new array but containing references to the SAME objects.
    // So modifying catItems[index].text IS modifying list field.
  } else {
    // We are adding a new item.
    // We need to push to the main list.
    // But wait, if we have gaps (e.g. index 0 filled, 1 empty, 2 filled), the array length might be smaller.
    // Our 'render' creates 5 inputs regardless.
    // So if user types in the 5th input (index 4), and we only have 0 items...
    // We should probably just rebuild the list from UI on save?
    // OR, simpler: Re-gather inputs immediately on every change?
    // Let's try: Re-gather inputs from UI into workingTemplates[currentMode] on every input. 
    // It's low cost (only 15 inputs).

    // Actually, 'updateWorkingState' is called on input. 
    // Let's just use a 'gather' function that grabs all 15 inputs and overwrites workingTemplates[currentMode].
    workingTemplates[currentMode] = gatherTemplatesFromDOM();
  }
}

function gatherTemplatesFromDOM() {
  const newTemplates = [];

  FIXED_CATEGORIES.forEach(catId => {
    const container = $(`group-${catId}`);
    if (!container) return; // Should not happen

    const inputs = container.querySelectorAll("input");
    inputs.forEach((input, idx) => {
      const val = input.value.trim();
      if (val) {
        newTemplates.push({
          id: `tpl-${currentMode}-${catId}-${Date.now()}-${idx}`, // regenerate ID is fine, or simpler
          text: val,
          categoryId: catId
        });
      }
    });
  });
  return newTemplates;
}

function initOptions() {
  const saveBtn = $("save-btn");
  const extensionEnabledCheckbox = $("global-extension-enabled");
  const autoSendCheckbox = $("global-autosend");
  const cooldownInput = $("global-cooldown");
  const btnFirst = $("mode-btn-first");
  const btnRegular = $("mode-btn-regular");
  const apiKeyInput = $("groq-api-key");
  const aiSendChatLogsCheckbox = $("ai-send-chat-logs");

  // Load
  loadAllFromStorage(({ globalSettings, templates }) => {
    // Default to true if undefined
    extensionEnabledCheckbox.checked = (globalSettings.extensionEnabled !== false);

    autoSendCheckbox.checked = !!globalSettings.autoSend;
    cooldownInput.value = globalSettings.coolDownMs.toString();
    aiSendChatLogsCheckbox.checked = !!globalSettings.aiSendChatLogs;

    if (globalSettings.groqApiKey) {
      apiKeyInput.value = globalSettings.groqApiKey;
    }

    workingTemplates = templates;
    if (globalSettings.activeMode) {
      currentMode = globalSettings.activeMode;
    }

    renderCurrentMode();
  });

  // Mode Switching
  btnFirst.addEventListener("click", () => {
    workingTemplates[currentMode] = gatherTemplatesFromDOM();
    currentMode = "first";
    renderCurrentMode();
  });

  btnRegular.addEventListener("click", () => {
    workingTemplates[currentMode] = gatherTemplatesFromDOM();
    currentMode = "regular";
    renderCurrentMode();
  });

  // Save
  saveBtn.addEventListener("click", () => {
    workingTemplates[currentMode] = gatherTemplatesFromDOM();

    const extensionEnabled = extensionEnabledCheckbox.checked;
    const autoSend = autoSendCheckbox.checked;
    const coolDownMs = parseInt(cooldownInput.value || "0", 10) || 0;
    const groqApiKey = apiKeyInput.value.trim();
    const aiSendChatLogs = aiSendChatLogsCheckbox.checked;

    loadAllFromStorage(({ globalSettings }) => {
      const newSettings = {
        ...globalSettings,
        extensionEnabled, // Save enabled state
        autoSend,
        coolDownMs,
        activeMode: currentMode,
        groqApiKey,
        aiSendChatLogs
      };

      saveAllToStorage(newSettings, workingTemplates);
    });
  });
}

document.addEventListener("DOMContentLoaded", initOptions);
