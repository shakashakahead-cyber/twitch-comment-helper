function compactChatLogs(chatLogs, { maxLines = 12, maxChars = 50 } = {}) {
  const logs = Array.isArray(chatLogs) ? chatLogs.slice(-maxLines) : [];
  return logs
    .map(l => String(l).replace(/\s+/g, " ").trim().slice(0, maxChars))
    .filter(Boolean)
    .map(l => `- ${l}`)
    .join("\n");
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForCompare(value) {
  return normalizeText(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function hasCommonSubstring(candidate, source, minLen) {
  const a = normalizeForCompare(candidate);
  const b = normalizeForCompare(source);
  if (a.length < minLen || b.length < minLen) return false;
  for (let i = 0; i <= a.length - minLen; i++) {
    const sub = a.slice(i, i + minLen);
    if (sub && b.includes(sub)) return true;
  }
  return false;
}

function bigramOverlapRatio(a, b) {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  if (na.length < 2 || nb.length < 2) return 0;

  const aSet = new Set();
  for (let i = 0; i < na.length - 1; i++) {
    aSet.add(na.slice(i, i + 2));
  }
  if (aSet.size === 0) return 0;

  const bSet = new Set();
  for (let i = 0; i < nb.length - 1; i++) {
    bSet.add(nb.slice(i, i + 2));
  }

  let overlap = 0;
  for (const bg of aSet) {
    if (bSet.has(bg)) overlap += 1;
  }
  return overlap / aSet.size;
}

function isGreetingLike(text) {
  const t = normalizeText(text);
  return /^(初見|初見失礼|はじめまして|こんにちは|こんばんは|おはよう|お邪魔します|来ました)/.test(t);
}

function looksAIMetaOrPolite(text) {
  const t = normalizeText(text);
  if (!t) return true;

  // Avoid meta output
  if (/\bAI\b/i.test(t) || /\bJSON\b/i.test(t) || /\bsuggestions\b/i.test(t)) return true;
  if (/出力|入力|生成|モデル|プロンプト|文脈|状況としては/.test(t)) return true;

  // Avoid "AIっぽい" polite/explanatory endings (except greetings)
  if (!isGreetingLike(t)) {
    if (/ですね|でしょう|と思います|かもしれません/.test(t)) return true;
    if (/(です|ます)([。！!w]|$)/.test(t)) return true;
  }

  return false;
}

function isTooSimilarToSources(candidate, sources) {
  const MIN_SUBSTRING = 6;
  const candidateNorm = normalizeForCompare(candidate);
  if (candidateNorm.length < MIN_SUBSTRING) return false;

  for (const src of sources) {
    if (hasCommonSubstring(candidate, src, MIN_SUBSTRING)) return true;
    if (candidateNorm.length >= 8 && bigramOverlapRatio(candidate, src) >= 0.85) return true;
  }
  return false;
}

function buildFallbackSuggestions(context) {
  const isFirstTime = !!context?.isFirstTime;
  const s = (context?.chatSignals && typeof context.chatSignals === "object") ? context.chatSignals : {};

  const pool = [];
  if (isFirstTime) {
    pool.push("初見です！", "こんばんは！", "お邪魔します！");
  }

  const tsukkomi = ["そこ行くんかいw", "今の判断よw", "そのミス痛いw", "今の間に合うのw"];
  const empathy = ["それキツいな…", "わかる、それある", "切り替えてこw"];
  const surprise = ["うわマジか！", "えっ今の何w", "まじで！？"];
  const question = ["今の狙い何？", "次どうする？", "それ勝負する？", "ここ守れる？"];
  const praise = ["今のうますぎ！", "ナイス判断！", "その反応神w", "いいぞいいぞ！"];
  const hype = ["うおお熱い！", "その展開アツい！", "きたきた！", "逆転ある！"];

  if ((Number(s.frustration) || 0) >= 2) pool.push(...empathy);
  if ((Number(s.hype) || 0) >= 2) pool.push(...hype);
  if ((Number(s.laugh) || 0) >= 2) pool.push(...tsukkomi);
  if ((Number(s.praise) || 0) >= 2) pool.push(...praise);

  pool.push(...surprise, ...question, ...praise, ...tsukkomi, ...empathy, ...hype);
  return pool;
}

function getChatSignalsSummary(chatSignals) {
  const s = (chatSignals && typeof chatSignals === "object") ? chatSignals : {};
  return {
    totalLines: Number(s.totalLines) || 0,
    laugh: Number(s.laugh) || 0,
    clap: Number(s.clap) || 0,
    hype: Number(s.hype) || 0,
    praise: Number(s.praise) || 0,
    question: Number(s.question) || 0,
    surprise: Number(s.surprise) || 0,
    frustration: Number(s.frustration) || 0,
    moodTags: Array.isArray(s.tags) ? s.tags.filter(Boolean).slice(0, 5) : []
  };
}

function postProcessSuggestions(rawSuggestions, context) {
  const MAX_LEN = 24;
  const chatLogs = Array.isArray(context?.chatLogs) ? context.chatLogs : [];
  const userHistory = Array.isArray(context?.userHistory) ? context.userHistory : [];
  const sources = [...chatLogs, ...userHistory].map(normalizeText).filter(Boolean);

  const out = [];
  const seen = new Set();

  for (const s of Array.isArray(rawSuggestions) ? rawSuggestions : []) {
    if (typeof s !== "string") continue;
    let t = normalizeText(s);
    t = t.replace(/^[-*>]\s*/, "");
    t = normalizeText(t);
    if (!t) continue;
    if (t.includes("\n")) continue;
    if (t.length > MAX_LEN) continue;

    const key = normalizeForCompare(t);
    if (!key || seen.has(key)) continue;
    if (looksAIMetaOrPolite(t)) continue;
    if (isTooSimilarToSources(t, sources)) continue;

    out.push(t);
    seen.add(key);
    if (out.length >= 8) break;
  }

  const isFirstTime = !!context?.isFirstTime;
  if (isFirstTime && !out.some(isGreetingLike)) {
    out.unshift("初見です！");
  }

  for (const fb of buildFallbackSuggestions(context)) {
    if (out.length >= 5) break;
    const t = normalizeText(fb);
    if (!t || t.length > MAX_LEN) continue;
    const key = normalizeForCompare(t);
    if (!key || seen.has(key)) continue;
    if (isTooSimilarToSources(t, sources)) continue;
    out.push(t);
    seen.add(key);
  }

  return out.slice(0, 5);
}

function formatChatSignals(chatSignals) {
  const s = getChatSignalsSummary(chatSignals);
  const tagText = s.moodTags.length ? s.moodTags.join(",") : "なし";
  return `直近${s.totalLines}行 / 雰囲気:${tagText} / 笑:${s.laugh} 拍手:${s.clap} 盛上:${s.hype} 称賛:${s.praise} 質問:${s.question} 驚:${s.surprise} 苦戦:${s.frustration}`;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type === "TCH_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (request?.type === "TCH_GENERATE_AI") {
    handleAIRequest(request.apiKey, request.context, request.isAuto)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err?.message || String(err) }));
    return true;
  }
});

async function handleAIRequest(apiKey, context, isAuto = false) {
  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
    return { success: false, error: "API_KEY_MISSING" };
  }

  const trimmedApiKey = apiKey.trim();
  const safeContext = (context && typeof context === "object") ? context : {};

  const chatLogs = Array.isArray(safeContext.chatLogs) ? safeContext.chatLogs : [];
  const hasChatLogs = chatLogs.length > 0;
  const compactedLogs = hasChatLogs ? compactChatLogs(chatLogs) : "";

  const model = isAuto ? "llama-3.1-8b-instant" : "llama-3.3-70b-versatile";
  const endpoint = "https://api.groq.com/openai/v1/chat/completions";

  const chatSignalsSummary = getChatSignalsSummary(safeContext.chatSignals);
  const chatSignalsText = formatChatSignals(safeContext.chatSignals);

  const systemPrompt = `あなたはTwitch配信を見ている日本語の視聴者です。視聴者がそのままチャットに送れる「短い一言コメント候補」を作ります。

目的:
- 配信の雰囲気に合う自然な一言を、候補として複数出す

禁止:
- 丁寧語(です/ます)、説明調、要約、自己言及、AIメタ発言
- 特定の視聴者への返信/会話（@メンション、名前呼び、〜さん など）

盗用の扱い:
- 直近チャットが与えられている場合、引用は禁止。
- 直近チャットに含まれる「6文字以上の連続した文字列」を出力に含めない。
- ただし一般的な短いスラング（草/ナイス/うま/えぐ/gg/888 等）の使用はOK。

コツ:
- 状況が不明なときは断定しない（安全寄りのリアクション/質問に逃げてOK）
- 配信者に向けた質問はOK（例:「今の狙い何？」）

出力:
- JSONのみ。形式: {"suggestions":[...]}（余計なキーや文章は禁止）
- suggestionsは12件。各要素は1行の文字列。最大24文字。重複しない。`;

  const logBlock = hasChatLogs
    ? `直近チャット(参考/引用禁止):\n${compactedLogs}`
    : "直近チャット:(未提供)";

  const promptContext = {
    mode: isAuto ? "auto" : "manual",
    stream: {
      title: safeContext.title || "不明",
      game: safeContext.game || "不明",
      streamer: safeContext.channelName || "不明",
      tags: Array.isArray(safeContext.tags) ? safeContext.tags.slice(0, 8) : []
    },
    viewer: {
      firstTime: !!safeContext.isFirstTime
    },
    chat: {
      window: "直近20行（画面に見えている範囲）",
      signals: chatSignalsSummary,
      signalsText: chatSignalsText
    }
  };

  const userPrompt = `コンテキスト(JSON):
${JSON.stringify(promptContext, null, 2)}

${logBlock}

生成方針:
- 12件は次の順で並べる:
  1-2 ツッコミ/ネタ
  3-4 共感/労い
  5-6 驚き/歓声
  7-8 質問
  9-10 応援・称賛
  11-12 保険（状況不明でも使える）
- firstTime が true なら、どれか1つは自然な挨拶にする
- 1語スパム（「草」「ナイス」「GG」「888」だけ）は避け、少しだけ状況に寄せる
- 固有名詞/数値は多用しない（全体で最大2つ）
出力は {"suggestions":[...]} のみ`.trim();

  const payload = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    response_format: { type: "json_object" },
    temperature: isAuto ? 0.6 : 0.75,
    max_tokens: 360
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${trimmedApiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 429) {
        const retryAfterStr = response.headers.get("retry-after");
        const retryAfter = retryAfterStr ? parseInt(retryAfterStr, 10) : 60;
        return {
          success: false,
          error: "RATE_LIMIT",
          retryAfter,
          details: `Groq Error 429: ${errorText}`
        };
      }
      return { success: false, error: `Groq Error ${response.status}: ${errorText}` };
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    if (!text) {
      return { success: false, error: "EMPTY_RESPONSE" };
    }

    let rawSuggestions = [];
    try {
      const parsed = JSON.parse(text);
      if (parsed?.suggestions && Array.isArray(parsed.suggestions)) {
        rawSuggestions = parsed.suggestions;
      } else if (Array.isArray(parsed)) {
        rawSuggestions = parsed;
      }
    } catch (e) {
      // Fall back to empty -> we will still return safe defaults
      console.warn("JSON Parse failed", text);
    }

    const processed = postProcessSuggestions(rawSuggestions, safeContext);
    return { success: true, data: processed };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
