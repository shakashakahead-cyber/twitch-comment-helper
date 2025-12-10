const DEFAULT_GLOBAL_SETTINGS = {
  autoSend: false,
  coolDownMs: 3000,
  position: null
};

const DEFAULT_TEMPLATES = {
  "*": [
    { id: "greet-1", text: "初見です！よろしくお願いします", categoryId: "greeting" },
    { id: "greet-2", text: "おつです！今日も来ました", categoryId: "greeting" },
    { id: "praise-1", text: "ナイス！", categoryId: "praise" },
    { id: "praise-2", text: "GG！", categoryId: "praise" },
    { id: "fun-1", text: "それは草", categoryId: "fun" },
    { id: "fun-2", text: "今日も安定の沼w", categoryId: "fun" }
  ]
};

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

function getCurrentChannelId() {
  const v = $("channel-id-input").value.trim();
  return v || "*";
}

function loadAllFromStorage(callback) {
  chrome.storage.sync.get(null, (data) => {
    const globalSettings =
      { ...DEFAULT_GLOBAL_SETTINGS, ...(data.globalSettings || {}) };
    const templates =
      data.templates && Object.keys(data.templates).length > 0
        ? data.templates
        : { ...DEFAULT_TEMPLATES };

    callback({ globalSettings, templates });
  });
}

function saveAllToStorage(globalSettings, templates, callback) {
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

function renderTemplatesTable(templatesForChannel) {
  const tbody = $("template-tbody");
  tbody.innerHTML = "";

  templatesForChannel.forEach((tpl, index) => {
    const tr = document.createElement("tr");

    const tdText = document.createElement("td");
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = tpl.text;
    textInput.dataset.index = index.toString();
    textInput.dataset.field = "text";
    tdText.appendChild(textInput);

    const tdCategory = document.createElement("td");
    const catInput = document.createElement("input");
    catInput.type = "text";
    catInput.value = tpl.categoryId;
    catInput.dataset.index = index.toString();
    catInput.dataset.field = "categoryId";
    tdCategory.appendChild(catInput);

    const tdActions = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.textContent = "削除";
    delBtn.dataset.index = index.toString();
    delBtn.addEventListener("click", () => {
      const currentChannelId = getCurrentChannelId();
      loadAllFromStorage(({ globalSettings, templates }) => {
        const list = templates[currentChannelId] || [];
        list.splice(index, 1);
        templates[currentChannelId] = list;
        saveAllToStorage(globalSettings, templates, () => {
          renderTemplatesTable(list);
        });
      });
    });
    tdActions.appendChild(delBtn);

    tr.appendChild(tdText);
    tr.appendChild(tdCategory);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });
}

function attachInputListeners() {
  $("template-tbody").addEventListener("input", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;

    const index = parseInt(target.dataset.index || "-1", 10);
    const field = target.dataset.field;
    if (Number.isNaN(index) || !field) return;

    const currentChannelId = getCurrentChannelId();
    loadAllFromStorage(({ globalSettings, templates }) => {
      const list = templates[currentChannelId] || [];
      if (!list[index]) return;
      if (field === "text") {
        list[index].text = target.value;
      } else if (field === "categoryId") {
        list[index].categoryId = target.value || "default";
      }
      templates[currentChannelId] = list;
      saveAllToStorage(globalSettings, templates);
    });
  });
}

function initOptions() {
  const channelInput = $("channel-id-input");
  const loadBtn = $("load-channel-btn");
  const addBtn = $("add-template-btn");
  const saveBtn = $("save-btn");
  const autoSendCheckbox = $("global-autosend");
  const cooldownInput = $("global-cooldown");

  loadAllFromStorage(({ globalSettings, templates }) => {
    autoSendCheckbox.checked = !!globalSettings.autoSend;
    cooldownInput.value = globalSettings.coolDownMs.toString();

    const initialChannelId = "*";
    channelInput.value = "";
    const list = templates[initialChannelId] || [];
    renderTemplatesTable(list);
  });

  loadBtn.addEventListener("click", () => {
    const channelId = getCurrentChannelId();
    loadAllFromStorage(({ globalSettings, templates }) => {
      const list = templates[channelId] || [];
      if (!templates[channelId]) {
        templates[channelId] = [];
        saveAllToStorage(globalSettings, templates);
      }
      renderTemplatesTable(list);
    });
  });

  addBtn.addEventListener("click", () => {
    const channelId = getCurrentChannelId();
    loadAllFromStorage(({ globalSettings, templates }) => {
      const list = templates[channelId] || [];
      const newId = `tpl-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      list.push({
        id: newId,
        text: "新しいテンプレ",
        categoryId: "greeting"
      });
      templates[channelId] = list;
      saveAllToStorage(globalSettings, templates, () => {
        renderTemplatesTable(list);
      });
    });
  });

  saveBtn.addEventListener("click", () => {
    const autoSend = autoSendCheckbox.checked;
    const coolDownMs = parseInt(cooldownInput.value || "0", 10) || 0;

    loadAllFromStorage(({ globalSettings, templates }) => {
      const newSettings = {
        ...globalSettings,
        autoSend,
        coolDownMs
      };
      saveAllToStorage(newSettings, templates);
    });
  });

  attachInputListeners();
}

document.addEventListener("DOMContentLoaded", initOptions);