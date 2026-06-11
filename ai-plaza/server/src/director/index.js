// ═══ 导演模块 v4：导演文件驱动 ═══
// 框架只负责：加载导演 .md → 注入动态上下文 → 调用 LLM → 解析输出
// 所有风格、规则、示例全在 data/directors/*.md 中
import { findChapter, findBeats, updateBeatStatus, updateChapterStatus, findCharacter, findAllChapters, findCharacterStates, getWorld, getOutline } from '../db/index.js';
import { llmCall, llmCallStream } from '../llm/index.js';
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
    // 回退：找目录中第一个可用的导演文件
    if (fs.existsSync(directorsDir)) {
      const files = fs.readdirSync(directorsDir).filter(f => f.endsWith('.md'));
      if (files.length > 0 && path.join(directorsDir, files[0]) !== fp) {
        return loadDirector(files[0].replace('.md', ''));
      }
    }
    // 最终兜底：硬编码默认导演
    return {
      id: 'default',
      name: '默认导演',
      persona: '你是专业的故事导演。',
      style: '平衡叙事与对话，自然流畅。',
      rules: '',
      example: '',
    };
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

// ═══ 构建 Prompt 上下文（共享） ═══
function buildPromptContext(chapterId, poolInterventions, directorId) {
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

  // ═══ 构建动态上下文 ═══
  const ctxParts = [];

  ctxParts.push(`【本章】第${currentOrder}章：${ch.title}`);
  ctxParts.push(`【本章目的】${ch.purpose || ''}`);
  if (ch.synopsis) ctxParts.push(`【本章梗概】${ch.synopsis}`);
  ctxParts.push(`【场景】${scenePrompt}`);

  ctxParts.push(`【情节节点】\n${beatRows.map(b => `  节点${b.beat_order}：${b.description}`).join('\n')}`);

  const charNames = charInfos.map(c => c.name);
  const charDescs = charInfos.map((c, i) =>
    `  ${i + 1}. ${c.name}（${c.title || ''}）：${c.personality?.core || ''} 说话风格：${c.personality?.speechStyle || '自然'}`
  ).join('\n');
  ctxParts.push(`【演员表——本章已确定的全部角色，共 ${charInfos.length} 人】\n${charDescs}\n\n⚠️ 以上 ${charNames.join('、')} 是本章的预设演员。对话行优先使用这些角色。如果场景需要临时角色（如路人、服务员、同事、围观者等）说话，你必须给他一个完整的真实姓名（2-3字中文姓名）和一句简略身份描述（如"保安刘大勇，退伍军人，眼神很利"），然后在对话中正常使用这个名字。严禁写匿名对话——每一个说话的人都有名字。`);

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

  // 组装 prompt
  const userPrompt = [
    director.style,
    director.rules,
    director.example ? `【参考示例——请模仿这个语感和节奏，但不要复制内容】\n${director.example}` : '',
    '━━━━━━━━━━━━━━━━━━━━',
    '以下是本章的具体设定。请根据以上风格指引，生成本章完整内容。',
    '',
    ...ctxParts,
  ].filter(Boolean).join('\n\n');

  const systemPrompt = director.persona
    ? `${director.persona}\n\n【铁律】所有角色说的话必须独占一行，格式为『角色名：台词』或『角色名：（动作）台词』。括号内是该说话者的神态动作。禁止在叙事段落中用引号嵌入对话——凡是角色开口，必须换行、署名、用脚本格式。禁止输出markdown标题（# ##等）。只输出表演内容，不要任何开场白或结束语。`
    : '【铁律】所有角色说的话必须独占一行，格式为『角色名：台词』或『角色名：（动作）台词』。括号内是该说话者的神态动作。禁止在叙事段落中用引号嵌入对话——凡是角色开口，必须换行、署名、用脚本格式。禁止输出markdown标题（# ##等）。只输出表演内容，不要任何开场白或结束语。';

  return { systemPrompt, userPrompt, director, charInfos, beatRows, scenePrompt, ch };
}

// ═══ 生成一章（批量模式） ═══
export async function generateChapter(chapterId, poolInterventions = [], directorId = 'default') {
  const { systemPrompt, userPrompt, charInfos, beatRows, scenePrompt } =
    buildPromptContext(chapterId, poolInterventions, directorId);

  const allMessages = [];

  // ── 氛围开头 ──
  allMessages.push({ id: 'atm_start', type: 'atmosphere', content: `📍 ${scenePrompt}`, timestamp: Date.now() });

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

// ═══ 判断名字是否像人名（防止"清晨""温度"等场景词被误判为对话） ═══
const NARRATIVE_KEYWORDS = /清晨|中午|下午|傍晚|晚上|凌晨|黄昏|黎明|温度|湿度|气温|天气|光线|气氛|灯光|音乐|广播|进行中|开始|结束|散场|距离|速度|高度|深度|宽度|面积|音量|人数|密度|气味|味道|颜色|形状|大小|长短|粗细|轻重/;
function looksLikePersonName(name) {
  if (!name || name.length < 2 || name.length > 4) return false;
  if (NARRATIVE_KEYWORDS.test(name)) return false;
  return /^[一-鿿]{2,4}$/.test(name);
}

// ═══ 流式增量解析器 ═══
// 【永久规则】对话气泡的显示依赖 type==='speech'。本节代码是气泡渲染的第一道防线。
// 任何对话行（名字：内容）必须被解析为 type:'speech'，严禁降级为 narration。
// 如需修改解析逻辑，必须保证所有 角色名：内容 格式的行都输出 speech 类型。
class IncrementalParser {
  constructor(charInfos, beatRows, onMessage) {
    this.charInfos = charInfos;
    this.beatRows = beatRows;
    this.onMessage = onMessage;
    this.buffer = '';
    this.currentNode = 0;

    // 构建角色名查找表 — 同时存储 name 和 id
    this.knownNames = new Map();
    for (const c of charInfos) {
      this.knownNames.set(c.name, c);
      if (c.id && c.id !== c.name) this.knownNames.set(c.id, c);
      // 同时存储 name 的简称形式（去掉姓氏，如"陈都灵"→"都灵"）
      if (c.name && c.name.length >= 2) {
        const short = c.name.slice(-2); // 取最后两字
        if (!this.knownNames.has(short)) this.knownNames.set(short, c);
      }
    }
  }

  resolveChar(name) {
    if (!name) return null;
    if (this.knownNames.has(name)) return this.knownNames.get(name);
    for (const [k, v] of this.knownNames) {
      if (k.endsWith(name) || name.endsWith(k) || (name.length >= 2 && k.includes(name))) {
        return v;
      }
    }
    return null;
  }

  // 判断一行是否为对话格式（名字：内容）
  isSpeechFormat(line) {
    return /^[^\s：:]{1,12}[：:]\s*.+/.test(line);
  }

  emit(msg) {
    // 流式后处理：speech 的 characterId 不像人名 → 降级为 narration
    if (msg.type === 'speech' && msg.characterId && !this.resolveChar(msg.characterId) && !looksLikePersonName(msg.characterId)) {
      msg.type = 'narration';
      msg.content = msg.characterId + '：' + msg.content;
      delete msg.characterId;
    }
    this.onMessage(msg);
  }

  flush() {
    const content = this.buffer.trim();
    if (!content) { this.buffer = ''; return; }

    // ── 检查缓冲中是否嵌入了对话行 ──
    const lines = content.split('\n');
    // 单行：对话格式 → speech，否则 narration
    if (lines.length === 1) {
      const sm = content.match(/^([^\s：:]+)[：:]\s*(.+)/);
      if (sm) {
        const char = this.resolveChar(sm[1]);
        this.emit({ id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'speech', characterId: char ? (char.id || sm[1]) : sm[1], content: sm[2].trim(), timestamp: Date.now() });
      } else {
        this.emit({ id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'narration', content, timestamp: Date.now() });
      }
      this.buffer = '';
      return;
    }

    // ── 多行缓冲：逐行扫描，对话行单独提取为 speech，其余合并为 narration ──
    let narrBuf = '';
    for (const line of lines) {
      const sm = line.match(/^([^\s：:]+)[：:]\s*(.+)/);
      if (sm) {
        if (narrBuf.trim()) {
          this.emit({ id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'narration', content: narrBuf.trim(), timestamp: Date.now() });
          narrBuf = '';
        }
        const char = this.resolveChar(sm[1]);
        this.emit({ id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'speech', characterId: char ? (char.id || sm[1]) : sm[1], content: sm[2].trim(), timestamp: Date.now() });
      } else {
        narrBuf += (narrBuf ? '\n' : '') + line;
      }
    }
    if (narrBuf.trim()) {
      this.emit({ id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'narration', content: narrBuf.trim(), timestamp: Date.now() });
    }
    this.buffer = '';
  }

  feedLine(line) {
    // 分隔线、省略号：跳过
    if (/^[-—]{2,}$/.test(line) || line === '"..."' || line === '...') return;

    // 节点标记
    const nodeMatch = line.match(/^【节点(\d+)】/);
    if (nodeMatch) {
      this.flush();
      // 关闭上一个节点
      if (this.currentNode > 0) {
        const prevBeat = this.beatRows.find(b => b.beat_order === this.currentNode);
        if (prevBeat) {
          this.emit({ id: `plot_${prevBeat.id}`, type: 'plot_progress', content: `📜 节点完成：${prevBeat.description} ✓`, timestamp: Date.now() });
        }
      }
      // 开启新节点
      this.currentNode = parseInt(nodeMatch[1]);
      const beat = this.beatRows.find(b => b.beat_order === this.currentNode);
      if (beat) {
        this.emit({ id: `node_start_${beat.id}`, type: 'node_start', content: `📍 节点${this.currentNode}：${beat.description}`, timestamp: Date.now() });
      }
      return;
    }

    // ── 对话行检测：名字：内容（第一道防线） ──
    // 匹配格式：1-12个非空白/非冒号字符 + 冒号（全角/半角）+ 非空内容
    // 【永久规则】任何 名字：内容 格式的行都必须输出为 type:'speech'。
    // 即使是临时路人角色（不在演员表），也必须以气泡形式显示。
    const sm = line.match(/^([^\s：:]{1,12})[：:]\s*(.+)/);
    if (sm) {
      this.flush(); // flush 之前的叙事缓冲
      const char = this.resolveChar(sm[1]);
      // 角色在演员表中 → 使用已知角色的 id
      // 角色不在演员表中 → 仍然输出 speech，用名字作为 characterId（前端会渲染气泡）
      this.emit({
        id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'speech',
        characterId: char ? (char.id || sm[1]) : sm[1],
        content: sm[2].trim(),
        timestamp: Date.now(),
      });
      return;
    }

    // 叙事：累积到缓冲
    this.buffer += (this.buffer ? '\n' : '') + line;
  }

  finish() {
    this.flush();
    // 关闭最后一个节点
    if (this.currentNode > 0) {
      const beat = this.beatRows.find(b => b.beat_order === this.currentNode);
      if (beat) {
        this.emit({ id: `plot_${beat.id}`, type: 'plot_progress', content: `📜 节点完成：${beat.description} ✓`, timestamp: Date.now() });
      }
    }
  }
}

// ═══ 流式生成一章 ═══
export async function generateChapterStream(chapterId, poolInterventions = [], directorId = 'default', onMessage, onProgress, signal) {
  const { systemPrompt, userPrompt, charInfos, beatRows, scenePrompt } =
    buildPromptContext(chapterId, poolInterventions, directorId);

  // ── 氛围开头（立即发送） ──
  onMessage({ id: 'atm_start', type: 'atmosphere', content: `📍 ${scenePrompt}`, timestamp: Date.now() });

  // ── 增量解析器 ──
  const parser = new IncrementalParser(charInfos, beatRows, onMessage);

  // ═══ 流式 LLM 调用 ═══
  try {
    await llmCallStream({
      systemPrompt,
      userMessage: userPrompt,
      temperature: 0.9,
      maxTokens: 12000,
      signal,
      onLine: (line) => {
        // 空行 → flush 叙事缓冲
        if (!line.trim()) {
          parser.flush();
        } else {
          parser.feedLine(line.trim());
        }
      },
      onDone: () => {
        parser.finish();
      },
    });
  } catch (e) {
    console.error('Generate stream error:', e.message);
    onMessage({
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
}
function parsePerformance(raw, charInfos, beatRows) {
  const messages = [];
  const lines = raw.split('\n');
  let buffer = '';
  let currentNode = 0;

  // 构建角色名查找表 — 存储 name、id 和简称
  const knownNames = new Map();
  for (const c of charInfos) {
    knownNames.set(c.name, c);
    if (c.id && c.id !== c.name) knownNames.set(c.id, c);
    if (c.name && c.name.length >= 2) {
      const short = c.name.slice(-2);
      if (!knownNames.has(short)) knownNames.set(short, c);
    }
  }

  function resolveChar(name) {
    if (!name) return null;
    if (knownNames.has(name)) return knownNames.get(name);
    for (const [k, v] of knownNames) {
      if (k.endsWith(name) || name.endsWith(k) || (name.length >= 2 && k.includes(name))) {
        return v;
      }
    }
    return null;
  }

  function isSpeechFormat(line) {
    return /^[^\s：:]{1,12}[：:]\s*.+/.test(line);
  }

  function flush() {
    const content = buffer.trim();
    if (!content) { buffer = ''; return; }

    const lines_in_buf = content.split('\n');
    // 单行缓冲：对话格式 → speech（不论角色是否在演员表），否则 narration
    if (lines_in_buf.length === 1) {
      const sm = content.match(/^([^\s：:]+)[：:]\s*(.+)/);
      if (sm && isSpeechFormat(content)) {
        const char = resolveChar(sm[1]);
        messages.push({ id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'speech', characterId: char ? (char.id || sm[1]) : sm[1], content: sm[2].trim(), timestamp: Date.now() });
      } else {
        messages.push({ id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'narration', content, timestamp: Date.now() });
      }
      buffer = '';
      return;
    }

    // 多行缓冲：逐行扫描提取对话（不论角色是否在演员表）
    let narrBuf = '';
    for (const line of lines_in_buf) {
      const sm = line.match(/^([^\s：:]+)[：:]\s*(.+)/);
      if (sm) {
        if (narrBuf.trim()) {
          messages.push({ id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'narration', content: narrBuf.trim(), timestamp: Date.now() });
          narrBuf = '';
        }
        const char = resolveChar(sm[1]);
        messages.push({ id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'speech', characterId: char ? (char.id || sm[1]) : sm[1], content: sm[2].trim(), timestamp: Date.now() });
      } else {
        narrBuf += (narrBuf ? '\n' : '') + line;
      }
    }
    if (narrBuf.trim()) {
      messages.push({ id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'narration', content: narrBuf.trim(), timestamp: Date.now() });
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
          messages.push({ id: `plot_${beat.id}`, type: 'plot_progress', content: `📜 节点完成：${beat.description} ✓`, timestamp: Date.now() });
        }
      }
      currentNode = parseInt(nodeMatch[1]);
      const beat = beatRows.find(b => b.beat_order === currentNode);
      if (beat) {
        messages.push({ id: `node_start_${beat.id}`, type: 'node_start', content: `📍 节点${currentNode}：${beat.description}`, timestamp: Date.now() });
      }
      continue;
    }

    // 对话行检测：任何 名字：内容 格式都输出为 speech
    const sm = t.match(/^([^\s：:]{1,12})[：:]\s*(.+)/);
    if (sm) {
      flush();
      const char = resolveChar(sm[1]);
      messages.push({ id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: 'speech', characterId: char ? (char.id || sm[1]) : sm[1], content: sm[2].trim(), timestamp: Date.now() });
      continue;
    }

    // 叙事：累积
    buffer += (buffer ? '\n' : '') + t;
  }
  flush();
  if (currentNode > 0) {
    const beat = beatRows.find(b => b.beat_order === currentNode);
    if (beat) {
      messages.push({ id: `plot_${beat.id}`, type: 'plot_progress', content: `📜 节点完成：${beat.description} ✓`, timestamp: Date.now() });
    }
  }

  // ── 后处理：最终扫描所有 narration，如果看起来是对话格式且有匹配角色，升级为 speech ──
  return reclassifyMessages(messages, knownNames, resolveChar);
}

// ═══ 后处理：双向纠正分类错误 ═══
// 1. narration → speech：对话行被误标为叙事时升级
// 2. speech → narration：场景词（"清晨""温度"等）被误标为对话时降级
function reclassifyMessages(messages, knownNames, resolveChar) {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // ── 方向1：narration → speech（已知角色被误判） ──
    if (msg.type === 'narration') {
      const sm = msg.content.match(/^([^\s：:]{1,12})[：:]\s*(.+)/);
      if (!sm) continue;
      const char = resolveChar(sm[1]);
      if (char) {
        msg.type = 'speech';
        msg.characterId = char.id || sm[1];
        msg.content = sm[2].trim();
      }
      continue;
    }

    // ── 方向2：speech → narration（场景词被误判为人名） ──
    // 核心修复：characterId 不像人名（如"清晨""温度""晚宴进行中"）→ 降级为叙事
    if (msg.type === 'speech' && msg.characterId) {
      const cid = msg.characterId;
      const char = resolveChar(cid);
      if (!char && !looksLikePersonName(cid)) {
        // 不是已知角色，且不像人名 → 把名字拼回内容，降级为 narration
        msg.type = 'narration';
        msg.content = cid + '：' + msg.content;
        delete msg.characterId;
      }
    }
  }
  return messages;
}
