
// Helper to compact logs for token optimization
function compactChatLogs(chatLogs, { maxLines = 15, maxChars = 60 } = {}) {
  const logs = (chatLogs || []).slice(-maxLines);
  return logs
    .map(l => String(l).replace(/\s+/g, " ").slice(0, maxChars))
    .map(l => `> ${l}`)
    .join("\n");
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "TCH_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
  } else if (request.type === "TCH_GENERATE_AI") {
    // Perform API call here to avoid CORS issues in content script
    handleAIRequest(request.apiKey, request.context, request.isAuto)
      .then(result => {
        sendResponse(result);
      })
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Will respond asynchronously
  }
});

async function handleAIRequest(apiKey, context, isAuto = false) {
  // Model Selection: 8B for Auto (Speed/Cost), 70B for Manual (Quality)
  // Groq Limits: 70B has lower TPD. 8B is very high.
  const model = isAuto ? "llama-3.1-8b-instant" : "llama-3.3-70b-versatile";

  const endpoint = "https://api.groq.com/openai/v1/chat/completions";

  // Prompt Construction
  const gameContext = context.game ? `「${context.game}」の` : "";
  const systemPrompt = `あなたはTwitchで${gameContext}配信を楽しんでいる視聴者（リスナー）の1人です。
その場に合った、自然な日本語のチャットを投稿してください。
AIとしての振る舞い（説明口調、丁寧語、要約）は一切不要です。`;

  // Compact logs to save tokens
  const compactedLogs = compactChatLogs(context.chatLogs);

  const userPrompt = `
配信タイトル:${context.title || '不明'}
ゲーム:${context.game || '不明'}
初見:${context.isFirstTime ? 'はい' : 'いいえ'}

直近ログ:
${compactedLogs}

依頼:
短いチャット案を5つ。
- 話題を推測してリアクション（感想・ツッコミ・共感・質問）
- 1つだけ具体要素（キャラ名/用語/数値）を含めてOK
- 1件あたり15〜25文字推奨
- 「初見」が「はい」の時だけ、1つ挨拶を混ぜる

出力はJSONオブジェクトのみ: {"suggestions": ["...","..."]}`;

  const payload = {
    model: model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" }, // Enforce JSON mode
    temperature: 0.7,
    max_tokens: 160
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Handle Rate Limit (429) specially
      if (response.status === 429) {
        const retryAfterStr = response.headers.get("retry-after");
        const retryAfter = retryAfterStr ? parseInt(retryAfterStr, 10) : 60; // Default 60s
        return {
          success: false,
          error: `RATE_LIMIT`,
          retryAfter: retryAfter,
          details: `Groq Error 429: ${errorText}`
        };
      }
      return { success: false, error: `Groq Error ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    const text = data.choices[0].message.content;

    let suggestions = [];
    try {
      const parsed = JSON.parse(text);
      if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
        suggestions = parsed.suggestions;
      } else if (Array.isArray(parsed)) {
        suggestions = parsed; // Fallback if model ignored object constraint
      }
    } catch (e) {
      console.warn("JSON Parse failed", text);
    }

    return { success: true, data: suggestions.filter(s => s).slice(0, 5) };

  } catch (error) {
    return { success: false, error: error.toString() };
  }
}