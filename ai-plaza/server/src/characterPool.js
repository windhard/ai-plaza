import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAR_DIR = path.resolve(__dirname, '..', '..', 'data', 'characters');

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

// ═══ 角色池 ═══
export const characterPool = new Map();

// 输出角色为 MD 文件（含 frontmatter）
export function saveCharacterToMD(char) {
  const id = char.id || toId(char.name);
  const filePath = path.join(CHAR_DIR, `${id}.md`);
  if (!fs.existsSync(CHAR_DIR)) fs.mkdirSync(CHAR_DIR, { recursive: true });

  const personality = char.personality || {};
  const frontmatter = {
    id,
    name: char.name,
    emoji: char.emoji || '👤',
    title: char.title || char.role || '未知',
    aggression: personality.aggression ?? 30,
    emotionalVolatility: personality.emotionalVolatility ?? 50,
    baseImpulse: personality.baseImpulse ?? 30,
    socialTendency: personality.socialTendency ?? 50,
    humorLevel: personality.humorLevel ?? 50,
  };

  const md = `# ${char.name} — 角色文件

## 基本信息
- **姓名**：${char.name}
- **Emoji**：${frontmatter.emoji}
- **身份**：${frontmatter.title}

## 性格
${personality.core || char.personalityHint || ''}

## 外貌
${char.appearance || '（未设定）'}

## 对话风格
${personality.speechStyle || ''}

## 系统提示词
\`\`\`
${char.systemPrompt || ''}
\`\`\`
`;
  const content = toYaml(frontmatter) + '\n\n' + md;
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// 从 MD 文件加载已有角色（含 frontmatter）
export function loadCharactersFromMD() {
  if (!fs.existsSync(CHAR_DIR)) return;
  const files = fs.readdirSync(CHAR_DIR).filter(f => f.endsWith('.md'));
  const emojis = ['☕', '👩‍💼', '🧑‍💻', '🕴️', '👔', '💼', '📋', '👤', '🔴', '💀', '🔥', '⚡', '🌟', '💎', '🎭'];
  let emojiIdx = 0;
  for (const file of files) {
    const id = file.replace('.md', '');
    if (characterPool.has(id)) continue;
    try {
      const raw = fs.readFileSync(path.join(CHAR_DIR, file), 'utf-8');
      const { data, body } = parseFrontmatter(raw);

      // 从 frontmatter 或 markdown body 提取
      const name = data.name || (body.match(/^#\s*(.+?)\s*[—\-]/m)?.[1]?.trim()) || id;
      const emoji = data.emoji || (body.match(/\*\*Emoji\*\*[：:]\s*(.+)/)?.[1]?.trim()) || (emojis[emojiIdx++] || '👤');
      const title = data.title || (body.match(/\*\*身份\*\*[：:]\s*(.+)/)?.[1]?.trim()) || '';
      const core = data.core || (body.match(/## 性格\n([\s\S]*?)(?=\n##|$)/)?.[1]?.trim()) || '';
      const appearance = data.appearance || (body.match(/## 外貌\n([\s\S]*?)(?=\n##|$)/)?.[1]?.trim()) || '';
      const speechStyle = data.speechStyle || (body.match(/## 对话风格\n([\s\S]*?)(?=\n##|$)/)?.[1]?.trim()) || '';
      const promptMatch = body.match(/```\n([\s\S]*?)```/);
      const systemPrompt = data.systemPrompt || promptMatch?.[1]?.trim() || `你是${name}。${core}`;

      characterPool.set(id, {
        id, name, emoji, title,
        appearance,
        personality: {
          core,
          speechStyle,
          humorLevel: data.humorLevel ?? 50,
          aggression: data.aggression ?? 30,
          emotionalVolatility: data.emotionalVolatility ?? 50,
          baseImpulse: data.baseImpulse ?? 30,
          socialTendency: data.socialTendency ?? 50,
        },
        systemPrompt, chapterPersonas: [],
      });
    } catch { /* skip broken files */ }
  }
}

// Duling 加载：纯从 MD 文件读，无硬编码兜底
export function loadDulingIdentity() {
  if (characterPool.has('陈都灵')) return characterPool.get('陈都灵');

  loadCharactersFromMD();
  if (characterPool.has('陈都灵')) return characterPool.get('陈都灵');

  // MD 文件不存在时，用最简参数自动生成（不含任何具体人设）
  const char = getOrCreateCharacter('陈都灵', '行政秘书', '');
  saveCharacterToMD(char);
  return char;
}

// 根据章节中的人物描述生成/获取角色
export function getOrCreateCharacter(nameHint, roleHint, personalityHint) {
  for (const [id, char] of characterPool) {
    if (char.name === nameHint || id === toId(nameHint)) return char;
  }

  const id = toId(nameHint);
  const emojis = ['☕', '👩‍💼', '🧑‍💻', '🕴️', '👔', '💼', '📋', '👤', '🔴', '💀'];
  const usedEmojis = new Set(Array.from(characterPool.values()).map(c => c.emoji));
  const emoji = emojis.find(e => !usedEmojis.has(e)) || '👤';

  const char = {
    id, name: nameHint, displayName: `${nameHint} ${emoji}`,
    emoji, avatarUrl: '', title: roleHint || '未知', appearance: '',
    personality: {
      core: personalityHint || '',
      speechStyle: '',
      humorLevel: 50, aggression: inferTrait(personalityHint, 'aggression'),
      emotionalVolatility: inferTrait(personalityHint, 'volatility'),
      baseImpulse: inferTrait(personalityHint, 'impulse'),
      socialTendency: inferTrait(personalityHint, 'social'),
    },
    secrets: [], triggers: [],
    systemPrompt: `你是${nameHint}，${roleHint || '一名角色'}。${personalityHint || ''}`,
    chapterPersonas: [],
  };

  if (personalityHint) {
    const p = personalityHint;
    if (/严厉|挑剔|控制|严格|凶|狠|冷酷|残忍/.test(p)) char.personality.aggression = 65 + Math.floor(Math.random() * 20);
    if (/温和|善良|随和|温柔|软/.test(p)) char.personality.aggression = 10 + Math.floor(Math.random() * 15);
    if (/情绪|敏感|波动|激动/.test(p)) char.personality.emotionalVolatility = 60 + Math.floor(Math.random() * 25);
    if (/冲动|冒失|火爆/.test(p)) char.personality.baseImpulse = 55 + Math.floor(Math.random() * 30);
    if (/社交|外向|爱聊|热情/.test(p)) char.personality.socialTendency = 65 + Math.floor(Math.random() * 25);
  }

  characterPool.set(id, char);
  return char;
}

function toId(name) {
  return name
    .replace(/[^一-龥a-zA-Z0-9]/g, '_')
    .toLowerCase()
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '') || 'unknown';
}

function inferTrait(hint, trait) {
  const base = { aggression: 40, volatility: 50, impulse: 35, social: 50 };
  return base[trait] + Math.floor(Math.random() * 20) - 10;
}
