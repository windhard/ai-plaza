// ═══ 剧本解析引擎 v3 ═══
// 支持 MD格式 / 自由格式 / 纯文本 / 关键词
// 先 regex 解析，再 LLM 增强，LLM 结果只增不减

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '..', '..', 'data');
const OUTLINE_FILE = resolve(DATA_DIR, 'outline.md');
const WORLD_FILE = resolve(DATA_DIR, 'world.md');

function readOutlineCtx() {
  try {
    const raw = readFileSync(OUTLINE_FILE, 'utf-8').trim();
    if (!raw || raw.includes('（未设定）')) return '';
    return `\n【故事大纲——全局走向，本章必须服务于大纲对应篇章】\n${raw.slice(0, 1500)}`;
  } catch { return ''; }
}

function readWorldCtx() {
  try {
    const raw = readFileSync(WORLD_FILE, 'utf-8').trim();
    if (!raw || raw.includes('（未设定）')) return '';
    return `\n【世界观设定——时代、社会背景、核心冲突】\n${raw.slice(0, 1000)}`;
  } catch { return ''; }
}

// ═══ LLM 调用 ═══
function loadEnv() {
  const envPath = resolve(__dirname, '..', '.env');
  const raw = readFileSync(envPath, 'utf-8');
  const env = {};
  raw.split('\n').forEach(line => {
    const m = line.match(/^([^=]+)=(.+)/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
  return env;
}

const ENV = loadEnv();
const API_KEY = ENV.DEEPSEEK_API_KEY || '';
const MODEL = ENV.DEEPSEEK_MODEL || 'deepseek-v4-pro';
const BASE_URL = 'https://api.deepseek.com/v1/chat/completions';

export async function llmCall({ systemPrompt, userMessage, temperature = 0.3, maxTokens = 4000 }) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature,
    max_tokens: maxTokens,
    thinking: { type: 'disabled' },
  };

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  const content = json.choices[0].message.content || '';
  return { content, usage: json.usage };
}

// ═══ MD 章节提取 ═══
function splitChapters(mdText) {
  // 按 ## 第X章 分割
  const blocks = mdText.split(/\n(?=##\s*第[一二三四五六七八九十\d]+章)/);
  if (blocks.length === 1 && !/^##\s*第/m.test(mdText)) {
    // 尝试 第X章： 自由格式
    const freeBlocks = mdText.split(/\n(?=第[一二三四五六七八九十\d]+章)/);
    if (freeBlocks.length > 1) return { blocks: freeBlocks, format: 'free' };
    return { blocks: [mdText], format: 'plain' };
  }
  return { blocks, format: 'md' };
}

// ═══ 字段提取 ═══
function extractField(body, field) {
  // **field**：value
  const mdMatch = body.match(new RegExp(`\\*\\*${field}\\*\\*[：:]\\s*(.+)`, 'i'));
  if (mdMatch) return mdMatch[1].trim();

  // field：value (行首)
  const lineMatch = body.match(new RegExp(`^${field}[：:]\\s*(.+)`, 'im'));
  if (lineMatch) return lineMatch[1].trim();

  return '';
}

// ═══ 情节节点提取 ═══
function extractBeats(body) {
  // 模式1：**情节**： 下的 - 列表
  const mdMatch = body.match(/\*\*情节(?:节点)?\*\*[：:]?\s*\n([\s\S]*?)(?=\n\*\*|\n##|\n第|\n人物|$)/i);
  if (mdMatch) {
    const lines = mdMatch[1].split('\n').map(l => l.trim()).filter(Boolean);
    const dashed = lines.filter(l => l.startsWith('-') || l.startsWith('•'));
    if (dashed.length > 0) return dashed.map(l => l.replace(/^[-•]\s*/, '').trim());
    // 没有 - 前缀但有内容，整行当作 beat
    if (lines.length > 0) return lines.map(l => l.replace(/^[-•]\s*/, '').trim());
  }

  // 模式2：情节： 下的行
  const freeMatch = body.match(/^情节(?:节点)?[：:]\s*\n([\s\S]*?)(?=\n\*\*|\n##|\n第|\n人物|$)/im);
  if (freeMatch) {
    const lines = freeMatch[1].split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) return lines.map(l => l.replace(/^[-•]\s*/, '').trim());
  }

  // 模式3：## 节点 / ## 情节 标题行
  const headingBeats = [];
  const headingRegex = /^##\s*(?:节点|情节|beat)\s*\d*[：:]\s*(.+)/gim;
  let hm;
  while ((hm = headingRegex.exec(body)) !== null) {
    headingBeats.push(hm[1].trim());
  }
  if (headingBeats.length > 0) return headingBeats;

  // 模式4：纯文本兜底 — 查找 "1. xxx" 或 "1、xxx" 编号行
  const numbered = [];
  const numRegex = /^\d+[.、)）]\s*(.+)/gm;
  let nm;
  while ((nm = numRegex.exec(body)) !== null) {
    const desc = nm[1].trim();
    if (desc.length >= 2 && desc.length <= 80) numbered.push(desc);
  }
  if (numbered.length >= 2) return numbered;

  return [];
}

// ═══ 人物提取 ═══
function extractCharacters(body) {
  const chars = [];
  // **人物A**：格式
  const mdRegex = /\*\*人物([A-Z]+)\*\*[：:]\s*(.+)/g;
  for (const m of body.matchAll(mdRegex)) {
    const parts = m[2].split(/[，,]/).map(s => s.trim());
    chars.push({
      letter: m[1],
      name: parts[0] || '',
      role: parts[1] || '',
      personality: parts.slice(2).join('，') || parts[1] || '',
    });
  }

  // 自由格式：人物：下每行
  if (chars.length === 0) {
    const charSection = body.match(/^人物[：:]\s*\n([\s\S]*?)(?=\n\*\*|\n##|\n第|$)/im);
    if (charSection) {
      const lines = charSection[1].split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const text = line.replace(/^[-•]\s*/, '');
        // "陈都灵（主角）：描述" 或 "陈都灵：描述"
        const parenMatch = text.match(/^(.+?)[（(](.+?)[）)][：:]\s*(.+)/);
        if (parenMatch) {
          chars.push({ letter: 'A', name: parenMatch[1].trim(), role: parenMatch[2].trim(), personality: parenMatch[3].trim() });
        } else {
          const simpleMatch = text.match(/^(.+?)[：:]\s*(.+)/);
          if (simpleMatch) {
            chars.push({ letter: 'A', name: simpleMatch[1].trim(), role: '', personality: simpleMatch[2].trim() });
          }
        }
      }
    }
  }

  return chars;
}

// ═══ 章节号提取 ═══
function parseChapterNumber(line) {
  const cnMap = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,
    '十一':11,'十二':12,'十三':13,'十四':14,'十五':15,'十六':16,'十七':17,'十八':18,'十九':19,'二十':20,
    '二十一':21,'二十二':22,'二十三':23,'二十四':24,'二十五':25,'二十六':26,'二十七':27,'二十八':28,'二十九':29,'三十':30,
    '三十一':31,'三十二':32,'三十三':33,'三十四':34,'三十五':35,'三十六':36,'三十七':37,'三十八':38,'三十九':39,'四十':40,
    '四十一':41,'四十二':42,'四十三':43,'四十四':44,'四十五':45,'四十六':46,'四十七':47,'四十八':48,'四十九':49,'五十':50 };
  const cnMatch = line.match(/第([一二三四五六七八九十]+)章/);
  if (cnMatch) return cnMap[cnMatch[1]] || 1;
  const numMatch = line.match(/第(\d+)章/);
  if (numMatch) return parseInt(numMatch[1]);
  return 0;
}

// ═══ Regex 解析（不依赖 LLM） ═══
function regexParse(mdText) {
  const { blocks, format } = splitChapters(mdText);
  const chapters = [];

  for (const [idx, block] of blocks.entries()) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    let title, body, chNum = idx + 1;

    if (format === 'md') {
      const fullTitle = lines[0].replace(/^##\s*/, '').trim();
      chNum = parseChapterNumber(fullTitle) || (idx + 1);
      const titleLine = fullTitle.replace(/^第[一二三四五六七八九十\d]+章[：:]\s*/, '').trim();
      title = titleLine || `第${chNum}章`;
      body = lines.slice(1).join('\n');
    } else if (format === 'free') {
      const fullTitle = lines[0].trim();
      chNum = parseChapterNumber(fullTitle) || (idx + 1);
      const titleLine = fullTitle.replace(/^第[一二三四五六七八九十\d]+章[：:]\s*/, '').trim();
      title = titleLine || `第${chNum}章`;
      body = lines.slice(1).join('\n');
    } else {
      // 纯文本：尝试提取第一个「第X章」作为章节号
      const firstChMatch = block.match(/第([一二三四五六七八九十\d]+)章/);
      if (firstChMatch) {
        chNum = parseChapterNumber(firstChMatch[0]) || (idx + 1);
        title = block.split('\n')[0].trim().slice(0, 30);
      } else {
        title = '文本解析结果';
      }
      body = block;
    }

    const purpose = extractField(body, '目的') || '';
    const scene = extractField(body, '场景') || '';
    const synopsis = extractField(body, '梗概') || extractField(body, '概要') || extractField(body, '大纲') || '';
    const beats = extractBeats(body);
    const characters = extractCharacters(body);

    // 如果完全没提取到结构，从纯文本自动推断
    if (beats.length === 0 && format === 'plain') {
      const paragraphs = body.split(/\n\n+/).filter(p => p.trim().length > 10);
      beats.push(...paragraphs.slice(0, 5).map(p => {
        const short = p.replace(/\n/g, ' ').slice(0, 60).trim();
        return short + (p.length > 60 ? '…' : '');
      }));
    }

    chapters.push({
      id: `ch_${chNum}`,
      order: chNum,
      title,
      purpose: purpose || '',
      scene: scene || '',
      synopsis: synopsis || '',
      beats: beats.map((desc, bi) => ({
        id: `b_${idx + 1}_${bi + 1}`,
        order: bi + 1,
        description: desc,
        status: idx === 0 && bi === 0 ? 'active' : 'pending',
      })),
      characters: characters.map(c => ({
        name: c.name,
        role: c.role || '',
        personalityHint: c.personality || '',
      })),
    });
  }

  return chapters;
}

// ═══ LLM 增强解析 ═══
export async function llmEnhanceParse(chapters, originalText) {
  try {
    const prompt = `你是资深剧本解析师。将以下文本解析为结构化 JSON。只输出 JSON。

格式：
{
  "chapters": [
    {
      "title": "精简章名（10字以内）",
      "purpose": "本章在整条故事线中要推进什么，与前后的因果逻辑",
      "synopsis": "100字故事梗概，概括本章核心冲突与转折",
      "scene": "生动具体的场景描写——必须包含：时间、光线、温度、气味、环境声响、空间细节、人物初始状态",
      "beats": ["情节节点1", "情节节点2"],
      "characters": [{"name":"真实人名（身份）","role":"身份","personalityHint":"性格特征描述"}]
    }
  ]
}

硬性要求：
- 每个字段都必须填写，不允许留空或写"待定""暂无"
- 如果输入模糊（如"上班、工作、下班"），请扩写为具体场景（如"清晨7点，办公室空无一人，窗帘缝隙透进第一缕白光"）
- 如果输入详细，保留原有细节并强化感官描写
- 纯故事文本：从中提取隐含的章节结构和人物
- beats 数量应与原文匹配，每章至少 2 个
- ⚠️ 每个 beat 的 description 必须极度精简，控制在8-15个汉字以内
- purpose 必须体现本章与前后章的因果递进关系
- synopsis 必须说清楚"发生了什么 → 导致了什么 → 悬念是什么"
- scene 必须有画面感，让读者能"看到"这个场景
- ⚠️ 人物命名铁律：每人必须有一个完整的真实中文姓名（姓+名，2-3字）。name 格式为"完整姓名（身份）"。严禁：①泛称（陌生男子、路人、某人）②姓+职位当名字（王经理、李秘书、刘主管、张总）③编号（同事A、搭档1）。没有名字就创造一个。每次创造的名字必须高度随机多样化——从百家姓中随机选取姓氏（赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张...），名字也要每次不同。
- ⚠️ 每章至少 2 个角色。这是剧本不是独角戏，一个人自言自语撑不起一场戏。即使原文只提了一个人，也必须根据场景推断出至少一个对戏角色。

示例 beat："早晨仪式感的日常" "暴雨中触电而死"`;

    const outlineCtx = readOutlineCtx();
    const worldCtx = readWorldCtx();
    const contextAugment = [outlineCtx, worldCtx].filter(Boolean).join('\n');

    const { content } = await llmCall({
      systemPrompt: prompt,
      userMessage: (contextAugment ? contextAugment + '\n\n待解析文本：\n' : '') + originalText.slice(0, 8000),
      temperature: 0.3,
      maxTokens: 5000,
    });

    if (!content || !content.includes('{')) return null;

    const clean = content.trim()
      .replace(/^```json\s*\n?|```$/g, '')
      .replace(/^[^{]*/, '')
      .replace(/[^}]*$/, '');

    const parsed = JSON.parse(clean);
    if (!parsed.chapters?.length) return null;

    // 统计 LLM 输出的总节数
    const llmTotalBeats = parsed.chapters.reduce((sum, ch) => sum + (ch.beats || []).length, 0);
    const regexTotalBeats = chapters.reduce((sum, ch) => sum + (ch.beats || []).length, 0);

    // 仅当 LLM 节数 >= regex 节数时才使用 LLM 增强结果
    // 特例：regex 为 0 时，LLM 结果直接采纳
    if (regexTotalBeats > 0 && llmTotalBeats < regexTotalBeats) {
      console.log(`  ⚠ LLM 增强节数(${llmTotalBeats}) < regex(${regexTotalBeats})，保留 regex 结果`);
      return null;
    }

    console.log(`  ✅ LLM 增强: ${llmTotalBeats} 节 (regex: ${regexTotalBeats})`);

    // 生成增强后的章节
    const enhanced = parsed.chapters.map((ch, o) => {
      // 保留 regex 的 ID 前缀
      const regexCh = chapters[o] || chapters[0];
      let cleanTitle = (ch.title || regexCh.title).replace(/^第[一二三四五六七八九十\d]+章[：:]\s*/, '');
      return {
        ...regexCh,
        title: cleanTitle,
        purpose: ch.purpose || regexCh.purpose || '',
        scene: ch.scene || regexCh.scene || '',
        synopsis: ch.synopsis || regexCh.synopsis || '',
        beats: (ch.beats || []).map((d, i) => ({
          id: `b_${o + 1}_${i + 1}`,
          order: i + 1,
          description: typeof d === 'string' ? d : d.description || '',
          status: o === 0 && i === 0 ? 'active' : 'pending',
        })),
        characters: (ch.characters || []).map(c => ({
          name: c.name,
          role: c.role || '',
          personalityHint: c.personalityHint || '',
        })),
      };
    });

    return enhanced;
  } catch (e) {
    console.log(`  ⚠ LLM 增强失败: ${e.message}`);
    return null;
  }
}

// ═══ 章节号校验 ═══
export function validateChapters(mdText) {
  // 必须包含「第X章」或「第X章」字样（X为数位或中文数字）
  const chapterPattern = /第[一二三四五六七八九十百零\d]+章/;
  if (!chapterPattern.test(mdText)) {
    return { valid: false, error: '文本中未检测到章节标记（如「第一章」「第1章」），请用 MD 格式或自由格式包含第X章字样。' };
  }
  return { valid: true };
}

// ═══ AI 高级编辑 ═══
export async function aiSeniorEdit(chapters, originalText, editorId = 'default') {
  try {
    // 根据 editorId 加载对应人格文件
    let editorPrompt;
    try {
      let editorPath;
      if (editorId === 'default') {
        editorPath = resolve(DATA_DIR, 'editor-profile.md');
      } else {
        editorPath = resolve(DATA_DIR, 'editors', `${editorId}.md`);
      }
      const raw = readFileSync(editorPath, 'utf-8').trim();
      // 提取「系统提示词」部分
      const promptMatch = raw.match(/## 系统提示词\n([\s\S]*?)(?=\n#|$)/);
      editorPrompt = promptMatch ? promptMatch[1].trim() : raw;
    } catch {
      editorPrompt = '你是一位从业30年的顶级文学编辑。请在不改变剧情走向的前提下优化章节名、人物性格描述和情节节点内容。只输出JSON。';
    }

    const input = JSON.stringify(chapters.map(ch => ({
      title: ch.title,
      purpose: ch.purpose,
      synopsis: ch.synopsis || '',
      scene: ch.scene,
      beats: ch.beats.map(b => b.description),
      characters: ch.characters || [],
    })), null, 2);

    const { content } = await llmCall({
      systemPrompt: editorPrompt,
      userMessage: input.slice(0, 6000),
      temperature: 0.5,
      maxTokens: 4000,
    });

    if (!content || !content.includes('{')) {
      console.log('  ✎ AI编辑返回空，保留原文');
      return chapters;
    }

    const clean = content.trim()
      .replace(/^```json\s*\n?|```$/g, '')
      .replace(/^[^{]*/, '')
      .replace(/[^}]*$/, '');

    const edited = JSON.parse(clean);
    if (!edited.chapters?.length) return chapters;

    console.log('  ✎ AI高级编辑已润色');

    // 合并：使用编辑后的文本，保留原始结构字段
    return chapters.map((ch, i) => {
      const ed = edited.chapters[i] || {};
      return {
        ...ch,
        title: ed.title || ch.title,
        purpose: ed.purpose || ch.purpose,
        scene: ed.scene || ch.scene,
        synopsis: ed.synopsis || ch.synopsis || '',
        beats: (ch.beats.length === 0 && (ed.beats || []).length > 0)
          ? (ed.beats || []).map((d, bi) => ({
              id: `b_${(ch.order || i + 1)}_${bi + 1}`,
              order: bi + 1,
              description: typeof d === 'string' ? d : d.description || '',
              status: i === 0 && bi === 0 ? 'active' : 'pending',
            }))
          : ch.beats.map((b, bi) => ({
              ...b,
              description: (ed.beats || [])[bi] || b.description,
            })),
        characters: (ed.characters || ch.characters).map((ec, ci) => ({
          name: ec.name || ch.characters[ci]?.name || '',
          role: ec.role || ch.characters[ci]?.role || '',
          personalityHint: ec.personalityHint || ch.characters[ci]?.personalityHint || '',
        })),
      };
    });
  } catch (e) {
    console.log(`  ⚠ AI编辑失败: ${e.message}，保留原文`);
    return chapters;
  }
}

// ═══ 主入口 ═══
export async function parseScript(mdText, { useLLM = true } = {}) {
  console.log(`\n📝 解析剧本 (${mdText.length} 字符, LLM=${useLLM})`);

  // 1. Regex 解析
  const regexChapters = regexParse(mdText);
  const totalBeats = regexChapters.reduce((s, c) => s + c.beats.length, 0);
  const totalChars = regexChapters.reduce((s, c) => s + c.characters.length, 0);
  console.log(`  Regex: ${regexChapters.length} 章, ${totalBeats} 节, ${totalChars} 人物`);

  // 2. LLM 增强（可选）
  let chapters = regexChapters;
  const totalRegexBeats = regexChapters.reduce((s, c) => s + c.beats.length, 0);
  if (useLLM && API_KEY) {
    const enhanced = await llmEnhanceParse(regexChapters, mdText);
    if (enhanced) chapters = enhanced;
  }

  // 3. 去重角色（跨章同名合并）—— 同时归一化 name/role
  const charMap = new Map();
  for (const ch of chapters) {
    for (const c of ch.characters || []) {
      if (!c.name) continue;
      // 归一化：从 "陈都灵（主角）" 拆分为 name="陈都灵" role="主角"
      let cleanName = c.name.trim();
      let cleanRole = c.role || '';
      const parenMatch = cleanName.match(/^(.+?)[（(]([^）)]+)[）)]$/);
      if (parenMatch) {
        cleanName = parenMatch[1].trim();
        if (!cleanRole) cleanRole = parenMatch[2].trim();
      }
      // 更新章节内角色的 name，确保 castList 用纯净名
      c.name = cleanName;

      if (!charMap.has(cleanName)) {
        charMap.set(cleanName, {
          name: cleanName,
          role: cleanRole || c.role || '',
          personalityHint: c.personalityHint,
        });
      } else {
        const existing = charMap.get(cleanName);
        if (cleanRole && !existing.role) existing.role = cleanRole;
        if (c.personalityHint && !existing.personalityHint) existing.personalityHint = c.personalityHint;
      }
    }
  }

  const characters = Array.from(charMap.values());

  // 4. 质量兜底：空字段用推导值填充
  for (const ch of chapters) {
    if (!ch.purpose || ch.purpose.trim() === '') {
      ch.purpose = `推进「${ch.title}」的情节发展，${ch.beats.length > 0 ? '通过' + ch.beats.map(b => b.description).join('、') + '等节点' : ''}展现角色冲突与情感变化`;
    }
    if (!ch.scene || ch.scene.trim() === '') {
      ch.scene = ch.beats.length > 0
        ? `以${ch.beats[0].description}为开场的连续场景`
        : '待补充场景描述';
    }
    if (!ch.synopsis || ch.synopsis.trim() === '') {
      ch.synopsis = ch.beats.length > 0
        ? ch.beats.map(b => b.description).join(' → ')
        : `${ch.title}：${ch.purpose.slice(0, 60)}`;
    }
  }

  // 5. 事后校验 + 靶向补救：缺什么补什么
  if (useLLM && API_KEY) {
    chapters = await repairDeficientChapters(chapters, mdText);
  }

  const synopsisCount = chapters.filter(c => c.synopsis && c.synopsis.trim()).length;
  console.log(`  最终: ${chapters.length} 章, ${chapters.reduce((s,c)=>s+c.beats.length,0)} 节, ${characters.length} 人物, ${synopsisCount} 梗概\n`);

  return { chapters, characters };
}

// ═══ 事后校验 + 靶向补救 ═══
async function repairDeficientChapters(chapters, originalText) {
  // 逐章检查缺失字段
  const deficient = [];
  for (const ch of chapters) {
    const missing = [];
    if (!ch.characters || ch.characters.length < 2) missing.push(`人物(当前${ch.characters?.length || 0}人，需≥2)`);
    if (!ch.beats || ch.beats.length < 2) missing.push('情节节点');
    if (!ch.scene || ch.scene.trim() === '' || ch.scene.startsWith('待补充')) missing.push('场景描述');
    if (!ch.synopsis || ch.synopsis.trim() === '') missing.push('故事梗概');
    if (!ch.purpose || ch.purpose.trim() === '') missing.push('章节目的');
    if (missing.length > 0) {
      deficient.push({ idx: chapters.indexOf(ch), title: ch.title, missing });
    }
  }

  if (deficient.length === 0) {
    console.log(`  ✅ 所有章节字段齐全，无需补救`);
    return chapters;
  }

  console.log(`  🔧 靶向补救: ${deficient.length} 章存在缺失 → ${deficient.map(d => `第${d.idx+1}章缺[${d.missing.join('/')}]`).join(', ')}`);

  // 构建针对性的 LLM 请求：只补缺失字段
  const repairList = deficient.map(d =>
    `第${d.idx + 1}章「${d.title}」：缺失 [${d.missing.join('、')}]`
  ).join('\n');

  const prompt = `你是剧本补全专家。以下章节解析后发现部分字段缺失，请只补全缺失的字段。只输出JSON。

缺失清单：
${repairList}
${readOutlineCtx()}
${readWorldCtx()}

原始输入文本（供参考上下文）：
${originalText.slice(0, 4000)}

输出格式：
{
  "chapters": [
    {
      "chapter_index": 0,
      "purpose": "补全的章节目的（如不缺则留空字符串）",
      "scene": "补全的场景描述——必须生动具体，包含时间地点氛围细节（如不缺则留空字符串）",
      "synopsis": "补全的故事梗概（如不缺则留空字符串）",
      "beats": ["补全的情节节点1", "补全的情节节点2"],
      "characters": [{"name":"真实人名（身份）","role":"身份","personalityHint":"性格特征"}]
    }
  ]
}

要求：
- 只补全缺失字段，已有字段留空字符串即可，不要覆盖
- ⚠️ 人物命名铁律：每人必须有一个完整的真实中文姓名（姓+名，2-3字）。name 格式为"完整姓名（身份）"。严禁：①泛称（陌生男子、路人、某人）②姓+职位当名字（王经理、李秘书、刘主管、张总）③编号（同事A、搭档1）。没有名字就创造一个。每次创造的名字必须高度随机多样化——从百家姓中随机选取姓氏，名字也要每次不同
- 人物：这是最高优先级。每章至少2人，这是硬底线。剧本必须有对手戏——如果某章当前只有1个角色，你必须创造一个合理的对戏角色（如场景在办公室→加同事，在家→加室友/邻居/快递）。角色名必须是随机创造的真实中文姓名
- 情节节点：每章至少2个，精简到8-15汉字
- 场景描述：生动具体，包含时间/光线/氛围/空间细节
- 梗概：说清"发生什么→导致什么→悬念是什么"
- 目的：体现本章在故事中的推进作用`;

  try {
    const { content } = await llmCall({
      systemPrompt: '你是剧本补全专家。只补全缺失字段，不缺的留空。只输出JSON。',
      userMessage: prompt,
      temperature: 0.4,
      maxTokens: 4000,
    });

    if (!content || !content.includes('{')) {
      console.log('  ⚠ 补救LLM返回空，保留现有结果');
      return chapters;
    }

    const clean = content.trim()
      .replace(/^```json\s*\n?|```$/g, '')
      .replace(/^[^{]*/, '')
      .replace(/[^}]*$/, '');

    const repaired = JSON.parse(clean);
    if (!repaired.chapters?.length) {
      console.log('  ⚠ 补救结果无chapters字段');
      return chapters;
    }

    // 合并：只填入非空字段
    let filledCount = 0;
    for (const rp of repaired.chapters) {
      const idx = rp.chapter_index ?? 0;
      if (idx >= chapters.length) continue;
      const ch = chapters[idx];

      if (!ch.purpose && rp.purpose && rp.purpose.trim()) {
        ch.purpose = rp.purpose.trim(); filledCount++;
      }
      if ((!ch.scene || ch.scene.startsWith('待补充')) && rp.scene && rp.scene.trim()) {
        ch.scene = rp.scene.trim(); filledCount++;
      }
      if (!ch.synopsis && rp.synopsis && rp.synopsis.trim()) {
        ch.synopsis = rp.synopsis.trim(); filledCount++;
      }
      if ((!ch.beats || ch.beats.length < 2) && rp.beats && rp.beats.length > 0) {
        ch.beats = rp.beats.map((d, i) => ({
          id: `b_${idx + 1}_${i + 1}`,
          order: i + 1,
          description: typeof d === 'string' ? d : d.description || '',
          status: idx === 0 && i === 0 ? 'active' : 'pending',
        }));
        filledCount++;
      }
      if ((!ch.characters || ch.characters.length < 2) && rp.characters && rp.characters.length > 0) {
        const existing = ch.characters || [];
        const existingNames = new Set(existing.map(c => c.name));
        const newChars = rp.characters
          .filter(c => c.name && !existingNames.has(c.name))
          .map(c => ({ name: c.name, role: c.role || '', personalityHint: c.personalityHint || '' }));
        // 追加而非覆盖：保留已有角色，补到至少2人
        ch.characters = [...existing, ...newChars].slice(0, Math.max(2, existing.length + newChars.length));
        if (newChars.length > 0) filledCount++;
      }
    }

    console.log(`  ✅ 靶向补救完成: 填补了 ${filledCount} 个缺失字段`);
  } catch (e) {
    console.log(`  ⚠ 补救失败: ${e.message}，保留现有结果`);
  }

  return chapters;
}

// ═══ 干预解析（兼容旧接口） ═══
export function parseIntervention(raw) {
  if (!raw || !raw.trim()) return null;
  const text = raw.trim();
  const thoughtMatch = text.match(/💉\s*节点(\d+)\s*[→>]\s*(.+?)\s*[→>]\s*["'](.+?)["']/);
  if (thoughtMatch) return { type: 'thought', targetNode: parseInt(thoughtMatch[1]), character: thoughtMatch[2].trim(), content: thoughtMatch[3].trim() };
  const speechMatch = text.match(/🗣\s*节点(\d+)\s*[→>]\s*(.+?)\s*[→>]\s*["'](.+?)["']/);
  if (speechMatch) return { type: 'speech', targetNode: parseInt(speechMatch[1]), character: speechMatch[2].trim(), content: speechMatch[3].trim() };
  const eventMatch = text.match(/⚡\s*节点(\d+)\s*[→>]\s*["'](.+?)["']/);
  if (eventMatch) return { type: 'event', targetNode: parseInt(eventMatch[1]), content: eventMatch[2].trim() };
  return null;
}

// ═══ 干预挂载 ═══
export function applyIntervention(beat, intervention) {
  if (!beat || !intervention) return;
  if (!Array.isArray(beat.interventions)) beat.interventions = [];
  beat.interventions.push(intervention);
}
