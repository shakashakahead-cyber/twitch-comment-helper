
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

  // 1. System Prompt: Role & Strict constraints
  const systemPrompt = `あなたはTwitchで${gameContext}配信を見ている視聴者（リスナー）。
出力は配信用の「短いリアクションチャット案」です。

【厳守ルール】
- 丁寧語/説明/要約/AIメタ発言（「AIです」「〜と思います」等）は一切禁止
- 語尾は「〜w / 〜じゃん / 〜かも / 〜！ / 〜？？」等で自然に
- 1件あたり15〜25文字
- ログの文章を8文字以上連続で引用しない（コピペ禁止）
- 誹謗中傷/差別/性的/個人情報/過度な指示（自治厨）は禁止
- JSONのみで返す: {"suggestions":[...]}`;

  // Compact logs to save tokens
  const compactedLogs = compactChatLogs(context.chatLogs);

  // 2. User Prompt: Context & Fixed Order Strategy
  const userPrompt = `
配信タイトル:${context.title || '不明'}
ゲーム:${context.game || '不明'}
初見:${context.isFirstTime ? 'はい' : 'いいえ'}

直近ログ:
${compactedLogs}

作成:
以下の**順番固定**で5件作成してください。
1. ツッコミ（鋭く）
2. 共感（しみじみ）
3. 驚き/歓声（短く）
4. 質問（相手が答えやすいもの）
5. 応援/称賛（ポジティブに）

※話題が推測できない時は無理せず、汎用の盛り上げ/質問にすること
※固有名詞/数値は全体で最大1件まで
※「初見」が「はい」の場合、どれか1つを**自然な挨拶**に置換

出力はJSONオブジェクトのみ: {"suggestions": ["...","...","...","...","..."]}`;

  const payload = {
    model: model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" }, // Enforce JSON mode
    temperature: 0.6, // Lower temperature for stability with templates
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