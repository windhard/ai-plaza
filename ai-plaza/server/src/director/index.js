// ═══ 导演模块 v4：导演文件驱动 ═══
// 框架只负责：加载导演 .md → 注入动态上下文 → 调用 LLM → 解析输出
// 所有风格、规则、示例全在 data/directors/*.md 中
import { findChapter, findBeats, updateBeatStatus, updateChapterStatus, findCharacter, findAllChapters, findCharacterStates, getWorld, getOutline } from '../db/index.js';
import { llmCall } from '../llm/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const directorsDir = path.resolve(__dir, '..', '..', '..', 'data', 'directors');

// ═══ 加载导演 .md 文件 → 拆解为各个段落 ═══
function loadDirector(directorId) {
  const id = directorId || 'default';
  const fp = path.join(directorsDir, `${id}.md`);
  if (!fs.existsSync(fp)) {
    return loadDirector('default');
  }
  const raw = fs.readFileSync(fp, 'utf-8');

  function section(title) {
    const re = new RegExp(`## ${title}\\n([\\s\\S]*?)(?=\\n## |$)`, 'i');
    const m = raw.match(re);
    return m ? m[1].trim() : '';
  }

  return {
    id,
    name: section('姓名') || id,
    persona: section('导演人格') || section('系统提示词') || section('导演提示词') || '',
    style: section('风格指引') || '',
    rules: section('写作规则') || '',
    example: section('示例') || '',
  };
}

// ═══ 生成一章 ═══
export async function generateChapter(chapterId, poolInterventions = [], directorId = 'default') {
  const director = loadDirector(directorId);
  const ch = findChapter(chapterId);
  if (!ch) throw new Error('Chapter not found');

  // ── 角色 ──
  let castList;
  try { castList = typeof ch.cast_list === 'string' ? JSON.parse(ch.cast_list) : (ch.cast_list || ch.castList || []); }
  catch { castList = ch.castList || []; }
  if (castList.length === 0) throw new Error('No characters in cast');

  const charInfos = [];
  for (const cid of castList) {
    const char = findCharacter(cid);
    if (char) charInfos.push(char);
  }

  const scenePrompt = ch.scene_prompt || ch.scene || '';
  const beatRows = findBeats(chapterId);
  const currentOrder = ch.chapter_order || 1;
  const allMessages = [];

  // ── 氛围开头 ──
  allMessages.push({ id: 'atm_start', type: 'atmosphere', content: `📍 ${scenePrompt}`, timestamp: Date.now() });

  // ═══ 构建动态上下文（框架职责） ═══
  const ctxParts = [];

  // 章节信息
  ctxParts.push(`【本章】第${currentOrder}章：${ch.title}`);
  ctxParts.push(`【本章目的】${ch.purpose || ''}`);
  if (ch.synopsis) ctxParts.push(`【本章梗概】${ch.synopsis}`);
  ctxParts.push(`【场景】${scenePrompt}`);

  // 情节节点
  ctxParts.push(`【情节节点】\n${beatRows.map(b => `  节点${b.beat_order}：${b.description}`).join('\n')}`);

  // 出场人物 —— 这就是本剧的全部演员表
  const charNames = charInfos.map(c => c.name);
  const charDescs = charInfos.map((c, i) =>
    `  ${i + 1}. ${c.name}（${c.title || ''}）：${c.personality?.core || ''} 说话风格：${c.personality?.speechStyle || '自然'}`
  ).join('\n');
  ctxParts.push(`【演员表——本章已确定的全部角色，共 ${charInfos.length} 人】\n${charDescs}\n\n⚠️ 以上 ${charInfos.length} 人是本章的全部出场人物。对话行开头的名字必须严格来自这个列表：${charNames.join('、')}。这些名字是在章节设计阶段就确定好的，就像导演在开拍前已经选好了演员。任何人不得在表演中临时加角色。`);

  // 干预指令
  let ivText = '';
  for (const beat of beatRows) {
    for (const iv of beat.interventions || []) {
      ivText += interventionText(iv, beat.beat_order);
    }
  }
  for (const iv of poolInterventions) {
    ivText += interventionText(iv, iv.beatOrder);
  }
  if (ivText) ctxParts.push(`【干预指令——必须执行】\n${ivText}`);

  // 世界观
  const worldContent = getWorld();
  if (worldContent && !worldContent.includes('（未设定）')) {
    ctxParts.push(`【世界观设定】\n${worldContent.slice(0, 1200)}`);
  }

  // 大纲
  const outlineContent = getOutline();
  if (outlineContent && !outlineContent.includes('（未设定）')) {
    ctxParts.push(`【故事大纲】\n${outlineContent.slice(0, 1500)}`);
  }

  // 前情提要
  const allChapters = findAllChapters();
  const prevChapters = allChapters
    .filter(c => (c.chapter_order || 999) < currentOrder)
    .sort((a, b) => (a.chapter_order || 0) - (b.chapter_order || 0));
  if (prevChapters.length > 0) {
    const recent = prevChapters.slice(-3);
    const earlier = prevChapters.slice(0, -3);
    const lines = [];
    if (earlier.length > 0) {
      lines.push(`更早章节：${earlier.map(c => `第${c.chapter_order}章「${c.title}」`).join('、')}`);
    }
    lines.push(recent.map(c =>
      `第${c.chapter_order}章「${c.title}」：${c.synopsis || c.purpose || '（无摘要）'}`
    ).join('\n'));
    ctxParts.push(`【前情提要】\n${lines.join('\n')}`);
  }

  // 角色当前状态
  const allStates = findCharacterStates();
  const relevantStates = allStates.filter(s => castList.includes(s.character_id));
  if (relevantStates.length > 0) {
    const stateLines = relevantStates.map(s => {
      const c = charInfos.find(ci => ci.id === s.character_id);
      const name = c?.name || s.character_id;
      return `  ${name}：情绪${Math.round(s.mood || 50)} 精力${Math.round(s.energy || 80)} 冲动${Math.round(s.impulse || 30)}${s.inner_thought ? ` 内心："${s.inner_thought}"` : ''}`;
    }).join('\n');
    ctxParts.push(`【角色当前状态（从上章继承）】\n${stateLines}`);
  }

  // ═══ 组装 prompt ═══
  // user prompt = 导演风格 + 规则 + 示例 + 动态上下文
  const userPrompt = [
    director.style,
    director.rules,
    director.example ? `【参考示例——请模仿这个语感和节奏，但不要复制内容】\n${director.example}` : '',
    '━━━━━━━━━━━━━━━━━━━━',
    '以下是本章的具体设定。请根据以上风格指引，生成本章完整内容。',
    '',
    ...ctxParts,
  ].filter(Boolean).join('\n\n');

  // system prompt = 导演人格
  const systemPrompt = director.persona
    ? `${director.persona}\n\n只输出内容，不要任何开场白或结束语。`
    : '只输出内容，不要任何开场白或结束语。';

  // ═══ LLM 调用 ═══
  try {
    const result = await llmCall({
      systemPrompt,
      userMessage: userPrompt,
      temperature: 0.9,
      maxTokens: 12000,
    });

    if (!result) throw new Error('LLM returned empty');
    const parsed = parsePerformance(result, charInfos, beatRows);
    allMessages.push(...parsed);
  } catch (e) {
    console.error('Generate error:', e.message);
    allMessages.push({
      id: 'err_gen', type: 'narration',
      content: `⚠️ 生成失败：${e.message}`,
      timestamp: Date.now(),
    });
  }

  // 更新状态
  for (const beat of beatRows) {
    updateBeatStatus(beat.id, 'done');
  }
  updateChapterStatus(chapterId, 'done');

  return { messages: allMessages };
}

// ═══ 干预文本 ═══
function interventionText(iv, beatOrder) {
  if (iv.type === 'thought') return `  💉 节点${beatOrder || ''} → ${iv.character || ''}：${iv.content}\n`;
  if (iv.type === 'speech') return `  🗣 节点${beatOrder || ''} → ${iv.character || ''} 必须说："${iv.content}"\n`;
  if (iv.type === 'event') return `  ⚡ 节点${beatOrder || ''}：${iv.content}\n`;
  return '';
}

// ═══ 解析 LLM 输出 → 消息列表 ═══
function parsePerformance(raw, charInfos, beatRows) {
  const messages = [];
  const lines = raw.split('\n');
  let buffer = '';
  let currentNode = 0;

  // 构建角色名查找表（用于匹配已知角色的 ID）
  const knownNames = new Map();
  for (const c of charInfos) {
    knownNames.set(c.name, c);
    if (c.id && c.id !== c.name) knownNames.set(c.id, c);
  }

  function resolveChar(name) {
    // 精确匹配
    if (knownNames.has(name)) return knownNames.get(name);
    // 模糊匹配
    for (const [k, v] of knownNames) {
      if (k.endsWith(name) || name.endsWith(k) || (name.length >= 2 && k.includes(name))) {
        return v;
      }
    }
    return null;
  }

  // 判断是否为对话行：名字：（动作）台词  或  名字：台词
  function isSpeechLine(line) {
    return /^[^\s：:]{1,10}[：:]\s*.+/.test(line);
  }

  function flush() {
    const content = buffer.trim();
    if (!content) { buffer = ''; return; }

    const sm = content.match(/^([^\s：:]+)[：:]\s*(.+)/);
    if (sm && isSpeechLine(content)) {
      const char = resolveChar(sm[1]);
      if (char) {
        // 角色在演员表中 → 对话气泡
        messages.push({
          id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'speech',
          characterId: char.id || sm[1],
          content: sm[2].trim(),
          timestamp: Date.now(),
        });
      } else {
        // 角色不在演员表中 → 降级为叙事，去掉名字前缀
        messages.push({
          id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'narration',
          content: sm[2].trim(),
          timestamp: Date.now(),
        });
      }
    } else {
      messages.push({
        id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'narration', content, timestamp: Date.now(),
      });
    }
    buffer = '';
  }

  for (const line of lines) {
    const t = line.trim();

    // 空行 = 段落结束
    if (!t) { flush(); continue; }

    // 分隔线、省略号：跳过
    if (/^[-—]{2,}$/.test(t) || t === '"..."' || t === '...') continue;

    // 节点标记
    const nodeMatch = t.match(/^【节点(\d+)】/);
    if (nodeMatch) {
      flush();
      if (currentNode > 0) {
        const beat = beatRows.find(b => b.beat_order === currentNode);
        if (beat) {
          messages.push({
            id: `plot_${beat.id}`, type: 'plot_progress',
            content: `📜 节点完成：${beat.description} ✓`, timestamp: Date.now(),
          });
        }
      }
      currentNode = parseInt(nodeMatch[1]);
      const beat = beatRows.find(b => b.beat_order === currentNode);
      if (beat) {
        messages.push({
          id: `node_start_${beat.id}`, type: 'node_start',
          content: `📍 节点${currentNode}：${beat.description}`, timestamp: Date.now(),
        });
      }
      continue;
    }

    // 对话行：格式匹配且角色在演员表中 → 气泡；否则 → 叙事
    const sm = t.match(/^([^\s：:]+)[：:]\s*(.+)/);
    if (sm && resolveChar(sm[1])) {
      flush();
      buffer = t;
      flush();
      continue;
    }
    // 格式像对话但角色不在演员表 → 去掉名字，当叙事
    if (sm && !resolveChar(sm[1])) {
      flush();
      buffer = sm[2];
      flush();
      continue;
    }

    // 叙事：累积
    buffer += (buffer ? '\n' : '') + t;
  }
  flush();
  if (currentNode > 0) {
    const beat = beatRows.find(b => b.beat_order === currentNode);
    if (beat) {
      messages.push({
        id: `plot_${beat.id}`, type: 'plot_progress',
        content: `📜 节点完成：${beat.description} ✓`, timestamp: Date.now(),
      });
    }
  }
  return messages;
}
