// ═══ 文件数据库：MD文件（可编辑内容）+ JSON（运行态数据） ═══
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data');
const CHAPTERS_DIR = path.join(DATA_DIR, 'chapters');
const CHARACTERS_DIR = path.join(DATA_DIR, 'characters');
const WORLD_FILE = path.join(DATA_DIR, 'world.md');
const OUTLINE_FILE = path.join(DATA_DIR, 'outline.md');
const DB_FILE = path.join(DATA_DIR, 'plaza.json');

// ═══ 简易 YAML frontmatter 解析 ═══
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)/);
  if (!match) return { data: {}, body: raw };
  const data = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    // 尝试解析数字/布尔/JSON
    if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if ((value.startsWith('[') || value.startsWith('{')) && value !== '[]') {
      try { value = JSON.parse(value); } catch { /* keep as string */ }
    }
    data[key] = value;
  }
  return { data, body: match[2].trim() };
}

function toYaml(data) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'object') lines.push(`${key}: ${JSON.stringify(value)}`);
    else lines.push(`${key}: ${value}`);
  }
  lines.push('---');
  return lines.join('\n');
}

// ═══ plaza.json 运行时数据 ═══
let plazaData = null;

function loadPlaza() {
  if (plazaData) return plazaData;
  try {
    plazaData = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch {
    plazaData = { plaza: { id: 'current', scene_description: '', current_chapter_id: '', phase: 'idle', paused: 0 }, chapters_index: [], character_states: {}, messages: [] };
  }
  return plazaData;
}

function savePlaza() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(plazaData, null, 2));
}

// ═══ 章节：从 .md 文件读取内容，从 plaza.json 读取元数据 ═══

function readChapterFile(id) {
  const fp = path.join(CHAPTERS_DIR, `${id}.md`);
  if (!fs.existsSync(fp)) return null;
  const raw = fs.readFileSync(fp, 'utf-8');
  const { data, body } = parseFrontmatter(raw);
  return { frontmatter: data, body };
}

function writeChapterFile(id, frontmatter, body) {
  if (!fs.existsSync(CHAPTERS_DIR)) fs.mkdirSync(CHAPTERS_DIR, { recursive: true });
  const yaml = toYaml(frontmatter);
  const content = yaml + '\n\n' + body;
  fs.writeFileSync(path.join(CHAPTERS_DIR, `${id}.md`), content);
}

function extractBeatsFromBody(body) {
  const beats = [];
  const lines = body.split('\n');
  let order = 0;
  for (const line of lines) {
    const m = line.match(/^##\s*节点\s*(\d+)[：:]\s*(.+)/);
    if (m) {
      order = parseInt(m[1]);
      beats.push({ order, description: m[2].trim() });
    } else {
      // Loose format: just "## <content>" without node number
      const lm = line.match(/^##\s+(.+)/);
      if (lm && !lm[1].startsWith('节点')) {
        order++;
        beats.push({ order, description: lm[1].trim() });
      }
    }
  }
  return beats;
}

function buildChapResponse(id, frontmatter, body, meta) {
  const beatsFromMd = extractBeatsFromBody(body);
  const beatsMeta = meta?.beats || [];
  const beats = beatsFromMd.map(bm => {
    const bmMeta = beatsMeta.find(b => b.order === bm.order) || {};
    return {
      id: `${id}_b_${bm.order}`,
      beat_order: bm.order,
      order: bm.order,
      description: bm.description,
      status: bmMeta.status || 'pending',
      interventions: bmMeta.interventions || [],
      chapter_id: id,
    };
  });
  return {
    id,
    chapter_order: frontmatter.order || 1,
    order: frontmatter.order || 1,
    title: frontmatter.title || '',
    purpose: frontmatter.purpose || '',
    scene: frontmatter.scene || '',
    scene_prompt: frontmatter.scene || '',
    synopsis: frontmatter.synopsis || '',
    cast_list: Array.isArray(frontmatter.cast) ? JSON.stringify(frontmatter.cast) : (frontmatter.cast || '[]'),
    castList: frontmatter.cast || [],
    status: meta?.status || 'pending',
    beats,
  };
}

export function findAllChapters() {
  const p = loadPlaza();
  const chapters = [];
  if (!fs.existsSync(CHAPTERS_DIR)) return chapters;
  for (const f of fs.readdirSync(CHAPTERS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const id = f.replace('.md', '');
    const file = readChapterFile(id);
    if (!file) continue;
    const meta = p.chapters_index.find(c => c.id === id);
    chapters.push(buildChapResponse(id, file.frontmatter, file.body, meta));
  }
  chapters.sort((a, b) => a.chapter_order - b.chapter_order);
  return chapters;
}

export function findChapter(id) {
  const file = readChapterFile(id);
  if (!file) return null;
  const p = loadPlaza();
  const meta = p.chapters_index.find(c => c.id === id);
  return buildChapResponse(id, file.frontmatter, file.body, meta);
}

export function upsertChapter(ch) {
  const p = loadPlaza();
  const id = ch.id;
  const file = readChapterFile(id) || { frontmatter: {}, body: '' };

  const frontmatter = {
    ...file.frontmatter,
    id,
    order: ch.chapter_order || ch.order || file.frontmatter.order || 1,
    title: ch.title || file.frontmatter.title || '',
    purpose: ch.purpose || file.frontmatter.purpose || '',
    scene: ch.scene || ch.scene_prompt || file.frontmatter.scene || '',
    synopsis: ch.synopsis || file.frontmatter.synopsis || '',
  };
  if (ch.cast_list) {
    try { frontmatter.cast = JSON.parse(ch.cast_list); } catch { frontmatter.cast = []; }
  } else if (ch.castList) {
    frontmatter.cast = ch.castList;
  }

  writeChapterFile(id, frontmatter, file.body);

  // 更新索引
  let meta = p.chapters_index.find(c => c.id === id);
  if (!meta) {
    meta = { id, order: frontmatter.order, title: frontmatter.title, status: ch.status || 'pending', beats: [] };
    p.chapters_index.push(meta);
  } else {
    meta.order = frontmatter.order;
    meta.title = frontmatter.title;
    if (ch.status) meta.status = ch.status;
  }
  savePlaza();
}

export function upsertChapters(chapters) {
  for (const ch of chapters) upsertChapter(ch);
}

export function findBeats(chapterId) {
  const ch = findChapter(chapterId);
  return ch ? ch.beats : [];
}

export function upsertBeat(beat) {
  const p = loadPlaza();
  let meta = p.chapters_index.find(c => c.id === beat.chapter_id);
  if (!meta) {
    meta = { id: beat.chapter_id, order: 0, title: '', status: 'pending', beats: [] };
    p.chapters_index.push(meta);
  }
  const order = beat.beat_order || beat.order || 1;
  const existing = meta.beats.find(b => b.order === order);
  if (existing) {
    existing.status = beat.status || existing.status || 'pending';
    existing.interventions = beat.interventions || existing.interventions || [];
  } else {
    meta.beats.push({ order, status: beat.status || 'pending', interventions: beat.interventions || [] });
  }
  meta.beats.sort((a, b) => a.order - b.order);
  savePlaza();
}

export function deleteBeatsByChapter(chapterId) {
  const p = loadPlaza();
  const meta = p.chapters_index.find(c => c.id === chapterId);
  if (meta) meta.beats = [];
  savePlaza();
}

export function updateBeatInterventions(beatId, interventions) {
  const p = loadPlaza();
  // beatId 格式: ch_X_b_Y, 提取 chapter_id 和 beat_order
  const parts = beatId.split('_b_');
  const chapterId = parts[0];
  const beatOrder = parseInt(parts[1]);
  const meta = p.chapters_index.find(c => c.id === chapterId);
  if (!meta) return;
  const beat = meta.beats.find(b => b.order === beatOrder);
  if (beat) beat.interventions = interventions;
  savePlaza();
}

export function updateBeatStatus(beatId, status) {
  const p = loadPlaza();
  const parts = beatId.split('_b_');
  const chapterId = parts[0];
  const beatOrder = parseInt(parts[1]);
  const meta = p.chapters_index.find(c => c.id === chapterId);
  if (!meta) return;
  const beat = meta.beats.find(b => b.order === beatOrder);
  if (beat) beat.status = status;
  savePlaza();
}

// ═══ 角色：从 .md 文件读取（含 frontmatter） ═══

export function findAllCharacters() {
  const chars = [];
  if (!fs.existsSync(CHARACTERS_DIR)) return chars;
  for (const f of fs.readdirSync(CHARACTERS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(CHARACTERS_DIR, f), 'utf-8');
    const { data, body } = parseFrontmatter(raw);
    if (!data.id && !data.name) continue;
    chars.push(parseCharFromMd(data, body));
  }
  return chars;
}

export function findCharacter(id) {
  const fp = path.join(CHARACTERS_DIR, `${id}.md`);
  if (!fs.existsSync(fp)) {
    // 尝试遍历查找匹配 name 的
    if (fs.existsSync(CHARACTERS_DIR)) {
      for (const f of fs.readdirSync(CHARACTERS_DIR)) {
        if (!f.endsWith('.md')) continue;
        const raw = fs.readFileSync(path.join(CHARACTERS_DIR, f), 'utf-8');
        const { data, body } = parseFrontmatter(raw);
        if (data.id === id || data.name === id) return parseCharFromMd(data, body);
      }
    }
    return null;
  }
  const raw = fs.readFileSync(fp, 'utf-8');
  const { data, body } = parseFrontmatter(raw);
  return parseCharFromMd(data, body);
}

function parseCharFromMd(data, body) {
  // 从 markdown body 提取文本字段（兼容旧格式）
  const nameMatch = body.match(/\*\*姓名\*\*[：:]\s*(.+)/);
  const emojiMatch = body.match(/\*\*Emoji\*\*[：:]\s*(.+)/);
  const titleMatch = body.match(/\*\*身份\*\*[：:]\s*(.+)/);
  const coreMatch = body.match(/## 性格\n([\s\S]*?)(?=\n##|$)/);
  const appearanceMatch = body.match(/## 外貌\n([\s\S]*?)(?=\n##|$)/);
  const speechMatch = body.match(/## 对话风格\n([\s\S]*?)(?=\n##|$)/);
  const promptMatch = body.match(/```\n([\s\S]*?)```/);

  const id = data.id || data.name || '';
  const name = data.name || nameMatch?.[1]?.trim() || id;
  const emoji = data.emoji || emojiMatch?.[1]?.trim() || '👤';
  const title = data.title || titleMatch?.[1]?.trim() || '';

  return {
    id, name, emoji, title,
    displayName: `${name} ${emoji}`,
    avatarUrl: '',
    appearance: data.appearance || appearanceMatch?.[1]?.trim() || '',
    personality: {
      core: data.core || coreMatch?.[1]?.trim() || '',
      speechStyle: data.speechStyle || speechMatch?.[1]?.trim() || '',
      humorLevel: data.humorLevel ?? 50,
      aggression: data.aggression ?? 30,
      emotionalVolatility: data.emotionalVolatility ?? 50,
      baseImpulse: data.baseImpulse ?? 30,
      socialTendency: data.socialTendency ?? 50,
    },
    secrets: [],
    triggers: [],
    systemPrompt: data.systemPrompt || promptMatch?.[1]?.trim() || `你是${name}。`,
    chapterPersonas: [],
  };
}

export function upsertCharacter(id, charDataStr) {
  let charData;
  try { charData = JSON.parse(charDataStr); } catch { charData = charDataStr; }

  const name = charData.name || id;
  const existingFile = path.join(CHARACTERS_DIR, `${id}.md`);
  let existingData = {};
  let existingBody = '';

  if (fs.existsSync(existingFile)) {
    const raw = fs.readFileSync(existingFile, 'utf-8');
    const parsed = parseFrontmatter(raw);
    existingData = parsed.data;
    existingBody = parsed.body;
  }

  const personality = charData.personality || {};
  const frontmatter = {
    ...existingData,
    id,
    name,
    emoji: charData.emoji || existingData.emoji || '👤',
    title: charData.title || existingData.title || '',
    aggression: personality.aggression ?? existingData.aggression ?? 30,
    emotionalVolatility: personality.emotionalVolatility ?? existingData.emotionalVolatility ?? 50,
    baseImpulse: personality.baseImpulse ?? existingData.baseImpulse ?? 30,
    socialTendency: personality.socialTendency ?? existingData.socialTendency ?? 50,
    humorLevel: personality.humorLevel ?? existingData.humorLevel ?? 50,
  };

  const body = existingBody || `# ${name} — 角色文件

## 基本信息
- **姓名**：${name}
- **Emoji**：${frontmatter.emoji}
- **身份**：${frontmatter.title || '未知'}

## 性格
${personality.core || ''}

## 外貌
${charData.appearance || '（未设定）'}

## 对话风格
${personality.speechStyle || ''}

## 系统提示词
\`\`\`
${charData.systemPrompt || `你是${name}。`}
\`\`\`
`;

  if (!fs.existsSync(CHARACTERS_DIR)) fs.mkdirSync(CHARACTERS_DIR, { recursive: true });
  const content = toYaml(frontmatter) + '\n\n' + body;
  fs.writeFileSync(existingFile, content);

  // 确保有运行时状态
  const p = loadPlaza();
  if (!p.character_states[id]) {
    p.character_states[id] = { mood: 50, energy: 80, impulse: 30, shame: 0, inner_thought: '', appearance_status: 'active' };
    savePlaza();
  }
}

export function deleteCharacter(id) {
  const fp = path.join(CHARACTERS_DIR, `${id}.md`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  const p = loadPlaza();
  delete p.character_states[id];
  savePlaza();
}

// ═══ 角色状态 ═══

export function findCharacterStates() {
  const p = loadPlaza();
  // 返回兼容旧格式: [{ character_id, mood, ... }]
  return Object.entries(p.character_states).map(([cid, s]) => ({ character_id: cid, ...s }));
}

export function upsertCharacterState(state) {
  const p = loadPlaza();
  const cid = state.character_id;
  p.character_states[cid] = { ...(p.character_states[cid] || {}), ...state };
  savePlaza();
}

// ═══ 消息 ═══

export function findAllMessages(chapterId) {
  const msgs = loadPlaza().messages;
  if (chapterId) return msgs.filter(m => m.chapter_id === chapterId).sort((a, b) => a.timestamp - b.timestamp);
  return msgs.sort((a, b) => b.timestamp - a.timestamp).slice(0, 200);
}

export function insertMessage(msg) {
  const p = loadPlaza();
  p.messages.push(msg);
  savePlaza();
}

export function insertMessages(msgs) {
  const p = loadPlaza();
  p.messages.push(...msgs);
  savePlaza();
}

export function clearMessages(chapterId) {
  const p = loadPlaza();
  p.messages = p.messages.filter(m => m.chapter_id !== chapterId);
  savePlaza();
}

// ═══ 广场状态 ═══

export function getPlaza() {
  return loadPlaza().plaza;
}

export function updatePlaza(patch) {
  const p = loadPlaza();
  Object.assign(p.plaza, patch);
  savePlaza();
}

export function deleteChapter(id) {
  // 删除 .md 文件
  const fp = path.join(CHAPTERS_DIR, `${id}.md`);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  // 删除索引和消息
  const p = loadPlaza();
  p.chapters_index = p.chapters_index.filter(c => c.id !== id);
  p.messages = p.messages.filter(m => m.chapter_id !== id);
  // 如果当前章是被删除的章，清空 current_chapter_id
  if (p.plaza.current_chapter_id === id) {
    p.plaza.current_chapter_id = '';
    p.plaza.scene_description = '';
    p.plaza.phase = 'idle';
  }
  savePlaza();

  // ═══ 清理孤儿角色：在所有剩余章节中均未出现的角色 → 删除 ═══
  cleanupOrphanCharacters();
}

// ═══ 清理不再被任何章节引用的角色 ═══
export function cleanupOrphanCharacters() {
  // 收集所有剩余章节中引用的角色名/ID
  const usedNames = new Set();
  const allChapters = findAllChapters();
  for (const ch of allChapters) {
    let cast = [];
    try {
      cast = typeof ch.cast_list === 'string' ? JSON.parse(ch.cast_list) : (ch.cast_list || []);
    } catch { cast = []; }
    for (const c of cast) {
      if (c) usedNames.add(String(c).trim());
    }
  }

  if (!fs.existsSync(CHARACTERS_DIR)) return;

  let deletedCount = 0;
  for (const f of fs.readdirSync(CHARACTERS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const charId = f.replace('.md', '');
    // 读取角色文件获取 name
    let charName = charId;
    try {
      const raw = fs.readFileSync(path.join(CHARACTERS_DIR, f), 'utf-8');
      const { data } = parseFrontmatter(raw);
      charName = data.name || charId;
    } catch { /* use charId as fallback */ }

    // 角色名和ID都不在任何章节的cast中 → 删除
    if (!usedNames.has(charId) && !usedNames.has(charName)) {
      fs.unlinkSync(path.join(CHARACTERS_DIR, f));
      // 同时清除 plaza.json 中的状态
      const p = loadPlaza();
      if (p.character_states[charId]) {
        delete p.character_states[charId];
        savePlaza();
      }
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    console.log(`  🧹 清理了 ${deletedCount} 个孤儿角色`);
  }
}

export function updateChapterStatus(id, status) {
  const p = loadPlaza();
  const meta = p.chapters_index.find(c => c.id === id);
  if (meta) { meta.status = status; savePlaza(); }
}

export function resetAll() {
  plazaData = {
    plaza: { id: 'current', scene_description: '', current_chapter_id: '', phase: 'idle', paused: 0 },
    chapters_index: [],
    character_states: {},
    messages: [],
  };
  savePlaza();
}

export function getDb() {
  return {
    chapters: findAllChapters(),
    characterStates: findCharacterStates(),
    messages: loadPlaza().messages,
    plaza: loadPlaza().plaza,
  };
}

// ═══ 世界观 & 大纲（纯 .md 文件读写） ═══

export function getWorld() {
  if (!fs.existsSync(WORLD_FILE)) return '';
  return fs.readFileSync(WORLD_FILE, 'utf-8');
}

export function updateWorld(content) {
  fs.writeFileSync(WORLD_FILE, content);
}

export function getOutline() {
  if (!fs.existsSync(OUTLINE_FILE)) return '';
  return fs.readFileSync(OUTLINE_FILE, 'utf-8');
}

export function updateOutline(content) {
  fs.writeFileSync(OUTLINE_FILE, content);
}
