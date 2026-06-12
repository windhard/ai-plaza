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

// 随机生成真实中文姓名
const SURNAMES = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮下齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄麴家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴鬱胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍卻璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公万俟司马上官欧阳夏侯诸葛闻人东方赫连皇甫尉迟公羊澹台公冶宗政濮阳淳于单于太叔申屠公孙仲孙轩辕令狐钟离宇文长孙慕容鲜于闾丘司徒司空丌官司寇仉督子车颛孙端木巫马公西漆雕乐正壤驷公良拓跋夹谷宰父谷梁晋楚闫法汝鄢涂钦段干百里东郭南门呼延归海羊舌微生岳帅缑亢况后有琴梁丘左丘东门西门商牟佘佴伯赏南宫墨哈谯笪年爱阳佟第五言福';
const GIVEN_MALE = '伟强磊洋勇军杰涛明超平辉健斌峰俊宁鹏飞亮毅松波涛东林志文华翔龙浩宇轩阳晨辰子涵浩然子轩皓宇鑫鹏晨曦';
const GIVEN_FEM = '芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳';
// Better given name list
const GIVEN_NAMES = '伟强磊洋勇军杰涛明超平辉健斌峰俊宁鹏飞亮毅松波涛东林志文华翔龙浩宇轩阳晨辰子涵浩然子轩皓宇鑫鹏晨曦芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳芳';

function randomRealName() {
  const s = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
  const g1 = GIVEN_NAMES[Math.floor(Math.random() * GIVEN_NAMES.length)];
  const g2 = GIVEN_NAMES[Math.floor(Math.random() * GIVEN_NAMES.length)];
  return s + g1 + (Math.random() > 0.5 ? g2 : '');
}

// 检测是否匿名代称
const ANONYMOUS_PATTERNS = /^(路人|无名|路人甲|某人|陌生|同事|服务员|保安|司机|快递|外卖|清洁工|保安大叔|前台|陌生人|无名氏|某某|路人乙|路人丙|群众|围观者)$/;
function isAnonymousName(name) {
  return ANONYMOUS_PATTERNS.test(name) || /路人|无名|某人|陌生|编号|同事[A-Z\d]/.test(name);
}

// 根据章节中的人物描述生成/获取角色
export function getOrCreateCharacter(nameHint, roleHint, personalityHint) {
  for (const [id, char] of characterPool) {
    if (char.name === nameHint || id === toId(nameHint)) return char;
  }

  // 匿名代称→随机真实姓名
  let actualName = nameHint;
  if (isAnonymousName(nameHint)) {
    actualName = randomRealName();
    // 把原代称作为身份提示
    if (!roleHint || roleHint === '未知') roleHint = nameHint;
  }

  const id = toId(actualName);
  const emojis = ['☕', '👩‍💼', '🧑‍💻', '🕴️', '👔', '💼', '📋', '👤', '🔴', '💀'];
  const usedEmojis = new Set(Array.from(characterPool.values()).map(c => c.emoji));
  const emoji = emojis.find(e => !usedEmojis.has(e)) || '👤';

  const role = roleHint || '未知身份';
  const char = {
    id, name: actualName, displayName: `${actualName} ${emoji}`,
    emoji, avatarUrl: '', title: role, appearance: '',
    personality: {
      core: personalityHint || '',
      speechStyle: '',
      humorLevel: 50, aggression: inferTrait(personalityHint, 'aggression'),
      emotionalVolatility: inferTrait(personalityHint, 'volatility'),
      baseImpulse: inferTrait(personalityHint, 'impulse'),
      socialTendency: inferTrait(personalityHint, 'social'),
    },
    secrets: [], triggers: [],
    systemPrompt: `你是${actualName}，${role}。${personalityHint || ''}`,
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

// ═══ LLM 丰富角色设定 ═══
async function callLLM(systemPrompt, userMessage) {
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.8,
      max_tokens: 800,
      thinking: { type: 'disabled' },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${j.error?.message || ''}`);
  return j.choices[0].message.content.trim();
}

export async function enrichCharacterWithLLM(char) {
  if (char.personality?.core && char.personality?.core.length > 30 && char.appearance && char.appearance.length > 10) {
    return char; // 已经有详细设定，跳过
  }

  const prompt = `为角色生成详细设定，输出JSON（不要markdown）：
{
  "core": "15-30字核心性格描述",
  "speechStyle": "10-20字说话风格（语速/用词/习惯）",
  "appearance": "20-40字外貌描写（年龄/体型/发型/五官/常穿服装）",
  "systemPrompt": "30-60字角色扮演指令",
  "aggression": 0-100,
  "emotionalVolatility": 0-100,
  "baseImpulse": 0-100,
  "socialTendency": 0-100
}`;

  try {
    const result = await callLLM(
      '你是角色设定专家。根据角色名和身份，生成真实、立体、有辨识度的人物设定。不允许模板化。',
      `角色名：${char.name}\n身份：${char.title || '未知'}\n已有描述：${char.personality?.core || '无'}\n\n${prompt}`
    );
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      char.personality.core = data.core || char.personality.core;
      char.personality.speechStyle = data.speechStyle || char.personality.speechStyle;
      char.appearance = data.appearance || char.appearance;
      char.systemPrompt = data.systemPrompt || char.systemPrompt;
      if (data.aggression != null) char.personality.aggression = data.aggression;
      if (data.emotionalVolatility != null) char.personality.emotionalVolatility = data.emotionalVolatility;
      if (data.baseImpulse != null) char.personality.baseImpulse = data.baseImpulse;
      if (data.socialTendency != null) char.personality.socialTendency = data.socialTendency;
      saveCharacterToMD(char);
    }
  } catch (e) {
    console.error('enrichCharacter failed for', char.name, ':', e.message);
  }
  return char;
}

function inferTrait(hint, trait) {
  const base = { aggression: 40, volatility: 50, impulse: 35, social: 50 };
  return base[trait] + Math.floor(Math.random() * 20) - 10;
}
