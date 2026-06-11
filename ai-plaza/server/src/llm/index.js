// ═══ LLM 调用封装 ═══
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, '..', '..', '.env') });

const PROVIDER = process.env.LLM_PROVIDER || 'deepseek';
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1/chat/completions';

/**
 * 单次 LLM 调用
 * @param {{systemPrompt:string, userMessage:string, temperature?:number, maxTokens?:number}} opts
 * @returns {Promise<string>}
 */
export async function llmCall({ systemPrompt, userMessage, temperature = 0.8, maxTokens = 500 }) {
  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
  };

  const res = await fetch(DEEPSEEK_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  return json.choices[0].message.content.trim();
}

/**
 * 并行批量 LLM 调用
 * @param {{id:string, systemPrompt:string, userMessage:string, temperature?:number, maxTokens?:number}[]} calls
 * @returns {Promise<Map<string,string>>}
 */
export async function llmCallBatch(calls) {
  const results = await Promise.allSettled(
    calls.map(c => llmCall(c).then(r => ({ id: c.id, result: r })))
  );
  const map = new Map();
  for (const r of results) {
    if (r.status === 'fulfilled') {
      map.set(r.value.id, r.value.result);
    }
  }
  return map;
}

/**
 * 模糊干预展开
 * @param {string} raw - 原始模糊描述
 * @param {{aggression:number}} personality - 角色人格参数
 * @returns {string}
 */
/**
 * 流式 LLM 调用 — 逐 token 回调
 * @param {{
 *   systemPrompt:string,
 *   userMessage:string,
 *   temperature?:number,
 *   maxTokens?:number,
 *   onToken?:(text:string)=>void,
 *   onLine?:(line:string)=>void,
 *   onDone?:()=>void,
 *   signal?:AbortSignal,
 * }} opts
 * @returns {Promise<string>} 完整文本
 */
export async function llmCallStream({ systemPrompt, userMessage, temperature = 0.9, maxTokens = 12000, onToken, onLine, onDone, signal }) {
  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
    stream: true,
  };

  const res = await fetch(DEEPSEEK_BASE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify(body),
    signal: signal || AbortSignal.timeout(180000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM error ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8', { stream: true });
  let fullText = '';
  let lineBuf = '';
  let sseBuf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      sseBuf += chunk;

      // 按 \n 分割 SSE 行
      const sseLines = sseBuf.split('\n');
      sseBuf = sseLines.pop() || ''; // 保留不完整行

      for (const sseLine of sseLines) {
        if (!sseLine.startsWith('data: ')) continue;
        const dataStr = sseLine.slice(6).trim();
        if (!dataStr || dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (!delta) continue;

          fullText += delta;
          if (onToken) onToken(delta);

          // 行缓冲：检测 \n 拆分完整行
          lineBuf += delta;
          if (lineBuf.includes('\n')) {
            const lines = lineBuf.split('\n');
            lineBuf = lines.pop() || ''; // 保留最后一个不完整行
            for (const line of lines) {
              if (onLine) onLine(line);
            }
          }
        } catch { /* skip parse errors */ }
      }
    }

    // flush 解码器
    const final = decoder.decode();
    if (final) {
      sseBuf += final;
      const sseLines = sseBuf.split('\n');
      for (const sseLine of sseLines) {
        if (!sseLine.startsWith('data: ')) continue;
        const dataStr = sseLine.slice(6).trim();
        if (!dataStr || dataStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            if (onToken) onToken(delta);
            lineBuf += delta;
            if (lineBuf.includes('\n')) {
              const lines = lineBuf.split('\n');
              lineBuf = lines.pop() || '';
              for (const line of lines) {
                if (onLine) onLine(line);
              }
            }
          }
        } catch { /* skip */ }
      }
    }

    // flush 最后的不完整行（如果有内容）
    if (lineBuf.trim() && onLine) onLine(lineBuf);

    if (onDone) onDone();
  } catch (e) {
    if (e.name === 'AbortError') {
      // 正常中止，flush 已有内容
      if (lineBuf.trim() && onLine) onLine(lineBuf);
      if (onDone) onDone();
    } else {
      throw e;
    }
  }

  return fullText;
}

export function expandFuzzyIntervention(raw, personality = {}) {
  const expansions = {
    '怒': '攥紧拳头，指节发白，胸口剧烈起伏',
    '想哭': '眼眶泛红，泪水在眼眶里打转，声音哽咽',
    '突然很害怕': '身体微微颤抖，心跳加速，手心出汗，呼吸变得急促',
    '想反抗': '攥紧拳头，心里有个声音在说"凭什么总是我听他的？"，但脸上仍维持着平静',
    '突然想反抗': '攥紧拳头，心里有个声音在说"凭什么总是我听他的？"，但脸上仍维持着平静',
    '咒骂': personality.aggression > 40 ? '狠狠骂了一句脏话' : '压低声音说了一句"你真过分"',
    '骂人': personality.aggression > 40 ? '破口大骂' : '带着哭腔低声骂了一句',
  };

  if (expansions[raw]) return expansions[raw];

  // 包含"骂"的模糊词
  if (raw.includes('骂') && raw.length <= 6) {
    return personality.aggression > 40 ? '用激烈的言辞咒骂' : '咬着牙低声骂了一句，声音带着颤抖';
  }

  return raw; // 已经是具体描述，直接返回
}
