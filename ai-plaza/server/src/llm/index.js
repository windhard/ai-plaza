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
