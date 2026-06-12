import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  findAllChapters, findChapter, upsertChapter, upsertChapters,
  findBeats, upsertBeat, updateBeatInterventions, updateBeatStatus, deleteBeatsByChapter,
  findAllCharacters, upsertCharacter, deleteCharacter,
  findCharacterStates, upsertCharacterState, updateChapterStatus,
  findAllMessages, insertMessages, clearMessages,
  getPlaza, updatePlaza, resetAll,
  getWorld, updateWorld, getOutline, updateOutline,
  deleteChapter, cleanupOrphanCharacters,
} from '../db/index.js';
import { parseScript, parseIntervention, validateChapters, aiSeniorEdit } from '../parser.js';
import { generateChapter, generateChapterStream } from '../director/index.js';
import { characterPool, getOrCreateCharacter, saveCharacterToMD, loadCharactersFromMD, enrichCharacterWithLLM } from '../characterPool.js';

// ═══ 启动时从 MD 加载角色 ═══
loadCharactersFromMD();

const router = Router();

// ═══ 工具：章节号提取 ═══
function extractChapterNumber(title) {
  const cnMap = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,
    '十一':11,'十二':12,'十三':13,'十四':14,'十五':15,'十六':16,'十七':17,'十八':18,'十九':19,'二十':20 };
  const cnMatch = title.match(/第([一二三四五六七八九十]+)章/);
  if (cnMatch) return cnMap[cnMatch[1]] || 1;
  const numMatch = title.match(/第(\d+)章/);
  if (numMatch) return parseInt(numMatch[1]);
  return 999;
}

// ═══ 广场状态 ═══
router.get('/plaza', (_req, res) => { res.json({ success: true, data: getPlaza() }); });
router.patch('/plaza', (req, res) => { updatePlaza(req.body); res.json({ success: true }); });

// ═══ 世界观 & 大纲 ═══
router.get('/world', (_req, res) => { res.json({ success: true, data: getWorld() }); });
router.put('/world', (req, res) => { updateWorld(req.body.content || ''); res.json({ success: true }); });
router.get('/outline', (_req, res) => { res.json({ success: true, data: getOutline() }); });
router.put('/outline', (req, res) => { updateOutline(req.body.content || ''); res.json({ success: true }); });

// ═══ 角色 ═══
router.get('/characters', (_req, res) => {
  // findAllCharacters() 现在直接返回 Character 对象数组
  const chars = findAllCharacters();
  res.json({ success: true, data: chars });
});
router.post('/characters', async (req, res) => {
  try {
    const existing = findAllCharacters().find(c => c.id === req.body.id);
    const merged = req.body;
    if (existing) {
      merged.personality = { ...existing.personality, ...req.body.personality };
    }
    upsertCharacter(req.body.id || merged.name, JSON.stringify(merged));
    characterPool.set(req.body.id || merged.name, merged);
    saveCharacterToMD(merged);
    // 同步等待LLM丰富角色设定
    const enriched = await enrichCharacterWithLLM(merged);
    upsertCharacter(enriched.id || enriched.name, JSON.stringify(enriched));
    characterPool.set(enriched.id || enriched.name, enriched);
    saveCharacterToMD(enriched);
    res.json({ success: true });
  } catch (e) {
    console.error('POST /api/characters error:', e.message);
    res.json({ success: true }); // 即使富化失败也返回成功（基础版本已保存）
  }
});
router.delete('/characters/:id', (req, res) => {
  deleteCharacter(req.params.id);
  characterPool.delete(req.params.id);
  res.json({ success: true });
});

// ═══ 状态 ═══
router.get('/states', (_req, res) => {
  const states = findCharacterStates();
  const map = {};
  for (const s of states) map[s.character_id] = s;
  res.json({ success: true, data: map });
});
router.patch('/states/:cid', (req, res) => {
  const states = findCharacterStates();
  const state = states.find(s => s.character_id === req.params.cid);
  if (!state) return res.status(404).json({ success: false });
  Object.assign(state, req.body);
  upsertCharacterState(state);
  res.json({ success: true });
});

// ═══ 章节 ═══
router.get('/chapters', (_req, res) => {
  const chapters = findAllChapters();
  chapters.sort((a, b) => {
    const na = a.chapter_order || 0;
    const nb = b.chapter_order || 0;
    return na - nb;
  });
  res.json({ success: true, data: chapters });
});

router.put('/chapters/:id', (req, res) => {
  const ch = findChapter(req.params.id);
  if (!ch) return res.status(404).json({ success: false });
  const updates = { ...req.body };
  if (updates.castList) {
    updates.cast_list = JSON.stringify(updates.castList);
    updates.castList = updates.castList;
  }
  delete updates.castList;

  // 更新章节 .md 文件
  if (updates.title || updates.purpose || updates.scene || updates.scene_prompt || updates.synopsis || updates.cast_list) {
    upsertChapter({ id: req.params.id, ...updates });
  }

  // 更新节点（beats）
  if (updates.beats) {
    deleteBeatsByChapter(req.params.id);
    for (const b of updates.beats) {
      upsertBeat({
        id: b.id || `${req.params.id}_b_${b.beat_order || b.order}`,
        chapter_id: req.params.id,
        beat_order: b.beat_order || b.order,
        description: b.description,
        status: b.status || 'pending',
        interventions: b.interventions || [],
      });
    }
    // 同时更新 .md 文件中的 beats body
    updateChapterBeatsBody(req.params.id, updates.beats);
  }

  if (updates.status) updateChapterStatus(req.params.id, updates.status);
  res.json({ success: true });
});

// 帮助函数：更新 chapter .md 文件中的 beats 部分
function updateChapterBeatsBody(id, beats) {
  const fp = path.join(
    path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'chapters', `${id}.md`
  );
  if (!fs.existsSync(fp)) return;
  let raw = fs.readFileSync(fp, 'utf-8');

  const frontmatterEnd = raw.indexOf('\n---\n', 4);
  if (frontmatterEnd < 0) return;
  const existingBody = raw.slice(frontmatterEnd + 5).trim();
  const frontmatter = raw.slice(0, frontmatterEnd + 5);

  // 保留 body 中不是节点标记的部分（或全部替换节点部分）
  const nonBeatLines = [];
  const existingLines = existingBody.split('\n');
  for (const line of existingLines) {
    if (!line.match(/^##\s*节点/)) nonBeatLines.push(line);
  }

  const beatLines = beats.map(b => `## 节点 ${b.beat_order || b.order}：${b.description}`);
  const newBody = nonBeatLines.join('\n').trim() + '\n\n' + beatLines.join('\n');
  fs.writeFileSync(fp, frontmatter + '\n' + newBody.trim());
}

// ═══ 删除章节 ═══
router.delete('/chapters/:id', (req, res) => {
  try {
    const ch = findChapter(req.params.id);
    if (!ch) return res.status(404).json({ success: false, error: '章节不存在' });
    deleteChapter(req.params.id);
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: String(e) }); }
});

// ═══ 节点干预 ═══
router.put('/beats/:id/interventions', (req, res) => {
  updateBeatInterventions(req.params.id, req.body.interventions || []);
  res.json({ success: true });
});

// ═══ 消息 ═══
router.get('/messages', (req, res) => {
  const data = findAllMessages(req.query.chapterId);
  res.json({ success: true, data });
});

// ═══ 剧本解析（含校验 + AI编辑） ═══
router.post('/parse-script', async (req, res) => {
  try {
    const { script, forceOverwriteChapter, editor } = req.body;
    if (!script || !script.trim()) return res.json({ success: false, error: '脚本为空' });

    const validation = validateChapters(script);
    if (!validation.valid) {
      return res.json({ success: false, error: validation.error });
    }

    const { chapters, characters } = await parseScript(script);
    const editedChapters = await aiSeniorEdit(chapters, script, editor || 'default');

    const output = editedChapters.map((ch, i) => ({
      id: `ch_${ch.order}`,
      order: ch.order,
      title: ch.title,
      purpose: ch.purpose,
      scene: ch.scene,
      synopsis: ch.synopsis || '',
      castList: (ch.characters || []).map(function(c) { return c.name; }),
      beats: ch.beats.map(function(b, bi) { return {
        id: `ch_${ch.order}_b_${bi + 1}`,
        beat_order: bi + 1,
        order: bi + 1,
        description: b.description,
        status: i === 0 && bi === 0 ? 'active' : 'pending',
        interventions: [],
      }; }),
      characters: ch.characters || [],
      status: 'pending',
    }));

    const existing = findAllChapters();
    const inputFirstNum = output[0]?.order || 1;
    const overlap = existing.find(c => c.chapter_order === inputFirstNum);

    res.json({
      success: true,
      data: { chapters: output, characters, hasOverlap: !!overlap, overlapTitle: overlap?.title || '' },
    });
  } catch (e) {
    res.json({ success: false, error: String(e) });
  }
});

// ═══ 干预解析 ═══
router.post('/parse-intervention', (req, res) => {
  try {
    const iv = parseIntervention(req.body.text);
    res.json({ success: true, data: iv });
  } catch (e) { res.json({ success: false, error: String(e) }); }
});

// ═══ 批量生成 ═══
router.post('/generate', async (req, res) => {
  try {
    const { chapterId, poolInterventions, director } = req.body;
    const ch = findChapter(chapterId);
    if (!ch) return res.status(404).json({ success: false, error: 'Chapter not found' });
    updateChapterStatus(chapterId, 'active');
    updatePlaza({ current_chapter_id: chapterId, phase: 'generating' });
    clearMessages(chapterId);
    const result = await generateChapter(chapterId, poolInterventions || [], director || 'default');
    for (const m of result.messages) m.chapter_id = chapterId;
    insertMessages(result.messages);
    updateChapterStatus(chapterId, 'done');
    updatePlaza({ phase: 'done' });
    res.json({ success: true, data: result });
  } catch (e) {
    console.error('Generate error:', e);
    res.json({ success: false, error: String(e) });
  }
});

// ═══ SSE 辅助 ═══
function sendSSE(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ═══ 批量生成（SSE 流式） ═══
router.post('/generate-stream', async (req, res) => {
  try {
    const { chapterId, poolInterventions, director } = req.body;
    const ch = findChapter(chapterId);
    if (!ch) return res.status(404).json({ success: false, error: 'Chapter not found' });

    // SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 更新状态
    updateChapterStatus(chapterId, 'active');
    updatePlaza({ current_chapter_id: chapterId, phase: 'generating' });
    clearMessages(chapterId);

    sendSSE(res, 'status', { phase: 'generating' });

    // AbortController：客户端断开时中止 LLM（监听 response close）
    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abortController.abort();
    });

    const savedMessages = [];

    await generateChapterStream(
      chapterId,
      poolInterventions || [],
      director || 'default',
      // onMessage
      (msg) => {
        msg.chapter_id = chapterId;
        savedMessages.push(msg);
        sendSSE(res, 'message', msg);
      },
      // onProgress（可选）
      null,
      // signal
      abortController.signal,
    );

    // 保存消息到 DB
    insertMessages(savedMessages);
    updateChapterStatus(chapterId, 'done');
    updatePlaza({ phase: 'done' });

    sendSSE(res, 'done', { messageCount: savedMessages.length });
    res.end();
  } catch (e) {
    console.error('Generate stream error:', e);
    try { sendSSE(res, 'error', { message: String(e) }); } catch {}
    try { res.end(); } catch {}
  }
});

// ═══ 保存章节 ═══
router.post('/save-chapters', (req, res) => {
  try {
    const { chapters } = req.body;
    if (!chapters?.length) return res.json({ success: true });

    const existing = findAllChapters();

    for (const ch of chapters) {
      const chNum = ch.order || 1;
      const sameNum = existing.find(c => c.chapter_order === chNum);
      const chId = sameNum ? sameNum.id : ch.id;

      if (sameNum) {
        deleteBeatsByChapter(sameNum.id);
      }

      upsertChapter({
        id: chId,
        chapter_order: ch.order || chNum,
        title: ch.title,
        purpose: ch.purpose,
        scene: ch.scene,
        cast_list: JSON.stringify(ch.castList || []),
        castList: ch.castList || [],
        status: ch.status || 'pending',
        scene_prompt: ch.scene,
        synopsis: ch.synopsis || '',
      });

      if (ch.beats) {
        deleteBeatsByChapter(chId);
        for (const beat of ch.beats) {
          upsertBeat({
            id: beat.id,
            chapter_id: chId,
            beat_order: beat.beat_order || beat.order,
            description: beat.description,
            status: beat.status || 'pending',
            interventions: beat.interventions || [],
          });
        }
        // 同时更新 .md 文件
        updateChapterBeatsBody(chId, ch.beats);
      }
    }

    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: String(e) }); }
});

// ═══ 切换当前章 ═══
router.post('/switch-chapter', (req, res) => {
  try {
    const { chapterId } = req.body;
    const ch = findChapter(chapterId);
    if (!ch) return res.status(404).json({ success: false, error: '章节不存在' });
    updatePlaza({ current_chapter_id: chapterId, scene_description: ch.scene_prompt || ch.scene });
    res.json({ success: true, data: ch });
  } catch (e) { res.json({ success: false, error: String(e) }); }
});

// ═══ 重置 ═══
router.post('/reset', (_req, res) => { resetAll(); res.json({ success: true }); });

// ═══ 可用编辑列表 ═══
router.get('/editors', (_req, res) => {
  try {
    const editorsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'editors');
    const result = [];
    if (fs.existsSync(editorsDir)) {
      for (const f of fs.readdirSync(editorsDir)) {
        if (!f.endsWith('.md')) continue;
        const raw = fs.readFileSync(path.join(editorsDir, f), 'utf-8');
        const nameMatch = raw.match(/## 姓名\n(.+)/);
        const prefMatch = raw.match(/## 偏好\n([\s\S]*?)(?=\n##|$)/);
        result.push({
          id: f.replace('.md', ''),
          name: nameMatch ? nameMatch[1].trim() : f.replace('.md', ''),
          desc: prefMatch ? prefMatch[1].trim().split('\n')[0].replace(/^[-•]\s*/, '') : '',
        });
      }
    }
    // 兜底：目录为空时给一个默认编辑
    if (result.length === 0) {
      result.push({ id: 'default', name: '默认编辑', desc: '30年资深编辑，均衡全面' });
    }
    res.json({ success: true, data: result });
  } catch (e) { res.json({ success: false, error: String(e) }); }
});

// ═══ 可用导演列表 ═══
router.get('/directors', (_req, res) => {
  try {
    const dirPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'directors');
    const result = [];
    if (fs.existsSync(dirPath)) {
      for (const f of fs.readdirSync(dirPath)) {
        if (!f.endsWith('.md')) continue;
        const raw = fs.readFileSync(path.join(dirPath, f), 'utf-8');
        const nameMatch = raw.match(/## 姓名\n(.+)/);
        const promptMatch = raw.match(/## 导演提示词\n([\s\S]*)/);
        result.push({
          id: f.replace('.md', ''),
          name: nameMatch ? nameMatch[1].trim() : f.replace('.md', ''),
          desc: promptMatch ? promptMatch[1].trim().slice(0, 60) : '',
        });
      }
    }
    // 兜底：目录为空时给一个默认导演
    if (result.length === 0) {
      result.push({ id: 'default', name: '默认导演', desc: '平衡叙事与对话，自然流畅' });
    }
    res.json({ success: true, data: result });
  } catch (e) { res.json({ success: false, error: String(e) }); }
});

// ═══ 从MD文件重载角色 ═══
router.post('/reload-characters', (_req, res) => {
  try {
    // 先清理不再被任何章节引用的孤儿角色
    cleanupOrphanCharacters();

    const __dir = path.dirname(fileURLToPath(import.meta.url));
    const charDir = path.resolve(__dir, '..', '..', 'data', 'characters');
    const mdFiles = new Set();
    if (fs.existsSync(charDir)) {
      fs.readdirSync(charDir).filter(f => f.endsWith('.md')).forEach(f => mdFiles.add(f.replace('.md', '')));
    }

    // 清除不在 MD 文件中的角色
    for (const [id] of characterPool) {
      if (!mdFiles.has(id)) characterPool.delete(id);
    }
    const allChars = findAllCharacters();
    for (const ch of allChars) {
      if (!mdFiles.has(ch.id)) deleteCharacter(ch.id);
    }

    // 重新加载
    loadCharactersFromMD();

    // 同步到运行时状态
    for (const [id, char] of characterPool) {
      upsertCharacter(id, JSON.stringify(char));
      const states = findCharacterStates();
      if (!states.find(s => s.character_id === id)) {
        upsertCharacterState({ character_id: id, mood: 50, energy: 80, impulse: 30, shame: 0, inner_thought: '', appearance_status: 'active' });
      }
    }
    res.json({ success: true, count: characterPool.size });
  } catch (e) { res.json({ success: false, error: String(e) }); }
});

export default router;
