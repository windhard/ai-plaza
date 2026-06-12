import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useStore } from './store/plazaStore';
import type { Intervention } from './types';

const BORDER = '1px solid #27272a';
const BG_PANEL = '#18181b';
const BG_DARK = '#0f0f0f';
const BG_INPUT = '#1c1c21';
const TEXT_PRIMARY = '#e4e4e7';
const TEXT_SECONDARY = '#a1a1aa';
const TEXT_MUTED = '#71717a';
const ACCENT = '#a78bfa';
const ACCENT_DIM = '#7c3aed';
const GREEN = '#4ade80';
const AMBER = '#fbbf24';
const CYAN = '#22d3ee';
const PINK = '#f472b6';
const TEAL = '#2dd4bf';
const BLUE = '#60a5fa';
const RED = '#f87171';

// ═══ 打字机组件 ═══
function Typewriter({ text, speed = 25, onDone }: { text: string; speed?: number; onDone?: () => void }) {
  if (speed <= 0) {
    return <span dangerouslySetInnerHTML={{ __html: text }} />;
  }
  const [displayed, setDisplayed] = useState('');
  const idxRef = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    setDisplayed(''); idxRef.current = 0;
    const timer = setInterval(() => {
      idxRef.current++;
      if (idxRef.current > text.length) { clearInterval(timer); doneRef.current?.(); return; }
      setDisplayed(text.slice(0, idxRef.current));
    }, speed);
    return () => clearInterval(timer);
  }, [text, speed]);
  return <span dangerouslySetInnerHTML={{ __html: displayed }} />;
}

// ═══ 池干预类型 ═══
interface PoolIntervention {
  type: 'thought' | 'speech' | 'event';
  character?: string;
  content: string;
  chapterId: string;
  beatId: string;
  beatOrder?: number;
}

export default function App() {
  const { characters, states, chapters, messages, plaza, generating, activeChapterId,
    loadAll, saveParsedChapters, parseScript, generateChapter, switchChapter, updateChapter, removeChapter,
    worldContent, outlineContent, loadWorld, saveWorld, loadOutline, saveOutline } = useStore();

  // ── 弹窗状态 ──
  const [showDesigner, setShowDesigner] = useState(false);
  const [showCharEditor, setShowCharEditor] = useState(false);
  const [editingCharId, setEditingCharId] = useState<string | null>(null);
  const [scriptInput, setScriptInput] = useState('');
  const [parseError, setParseError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState('');
  const [selectedEditor, setSelectedEditor] = useState('default');
  const [editors, setEditors] = useState<{ id: string; name: string; desc: string }[]>([]);
  const [overwriteConfirm, setOverwriteConfirm] = useState<any>(null);

  // ── 删除章节确认 ──
  const [deleteChConfirm, setDeleteChConfirm] = useState<string | null>(null);
  const [batchDeleteMode, setBatchDeleteMode] = useState(false);
  const [selectedChapters, setSelectedChapters] = useState<Set<string>>(new Set());

  // ── 世界观 / 大纲弹窗 ──
  const [showContentModal, setShowContentModal] = useState(false);
  const [contentModalType, setContentModalType] = useState<'world' | 'outline'>('world');
  const [worldEdit, setWorldEdit] = useState('');
  const [outlineEdit, setOutlineEdit] = useState('');

  // ── 表演确认弹窗 ──
  const [showPerformConfirm, setShowPerformConfirm] = useState(false);

  // ── 干预池 ──
  const [poolIvs, setPoolIvs] = useState<PoolIntervention[]>([]);
  const [showPool, setShowPool] = useState(false);

  // ── 导演选择 ──
  const [directors, setDirectors] = useState<{ id: string; name: string; desc: string }[]>([]);
  const [selectedDirector, setSelectedDirector] = useState('');

  // ── 💉 注入行 ──
  const [ivChapter, setIvChapter] = useState('');
  const [ivBeat, setIvBeat] = useState('');
  const [ivTarget, setIvTarget] = useState('');
  const [ivContent, setIvContent] = useState('');

  // ── 🗣 强制发言行 ──
  const [spChapter, setSpChapter] = useState('');
  const [spBeat, setSpBeat] = useState('');
  const [spTarget, setSpTarget] = useState('');
  const [spContent, setSpContent] = useState('');

  // ── ⚡ 突发事件行 ──
  const [evChapter, setEvChapter] = useState('');
  const [evBeat, setEvBeat] = useState('');
  const [evContent, setEvContent] = useState('');

  // ── 章节结构编辑 ──
  const [editChTitle, setEditChTitle] = useState('');
  const [editChPurpose, setEditChPurpose] = useState('');
  const [editChScene, setEditChScene] = useState('');
  const [editChSynopsis, setEditChSynopsis] = useState('');
  const [editChBeats, setEditChBeats] = useState('');

  // ── 动画控制：依次打字 ──
  const [typingIdx, setTypingIdx] = useState(0);
  const completedChapters = useRef<Set<string>>(new Set());
  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadAll(); fetch('/api/directors').then(r=>r.json()).then(j=>{ setDirectors(j.data||[]); setSelectedDirector(j.data?.[0]?.id || 'default'); }); }, []);
  // 滚动：typingIdx 变化或消息数增长时自动滚到底部
  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: generating ? 'auto' : 'smooth' }); }, [typingIdx, messages.length]);

  // 新消息到达时：生成中不重置 typingIdx（由打字完成驱动），其余场景保持原逻辑
  useEffect(() => {
    if (generating) return; // 生成中由 advanceTyping 全权控制节奏
    if (messages.length === 0) { setTypingIdx(0); return; }
    if (completedChapters.current.has(activeChapterId || '')) {
      setTypingIdx(messages.length);
    } else {
      const ch = chapters.find(c => c.id === activeChapterId);
      if (ch?.status === 'done' && messages.length > 10) {
        completedChapters.current.add(activeChapterId || '');
        setTypingIdx(messages.length);
      } else {
        setTypingIdx(0);
      }
    }
  }, [messages, activeChapterId, chapters, generating]);

  // 当前消息打完 → 显示下一条
  const advanceTyping = useCallback(() => {
    setTypingIdx(i => {
      const next = Math.min(i + 1, messages.length);
      // 全部打完 → 标记本章已完成
      if (next >= messages.length && activeChapterId) {
        completedChapters.current.add(activeChapterId);
      }
      return next;
    });
  }, [messages.length, activeChapterId]);

  // ── 衍生数据 ──
  const activeChapter = useMemo(() => chapters.find(c => c.id === activeChapterId), [chapters, activeChapterId]);
  const activeBeats = useMemo(() => activeChapter?.beats || [], [activeChapter]);
  const totalBeats = useMemo(() => chapters.reduce((s, c) => s + c.beats.length, 0), [chapters]);
  const doneBeats = useMemo(() => activeChapter?.beats.filter(b => b.status === 'done').length || 0, [activeChapter]);
  const getCharById = (id?: string) => characters.find(c => c.id === id);

  const getCastIds = (chId: string) => {
    const ch = chapters.find(c => c.id === chId);
    if (!ch) return [];
    try { return typeof ch.cast_list === 'string' ? JSON.parse(ch.cast_list) : (ch.cast_list || (ch as any).castList || []); }
    catch { return (ch as any).castList || []; }
  };
  const activeCastIds = useMemo(() => getCastIds(activeChapterId || ''), [chapters, activeChapterId]);
  const castForIv = useMemo(() => getCastIds(ivChapter), [chapters, ivChapter]);
  const castForSp = useMemo(() => getCastIds(spChapter), [chapters, spChapter]);

  const getCharsForCast = (castIds: string[]) => characters.filter(c => castIds.includes(c.id) || castIds.includes(c.name));
  const charsForIv = useMemo(() => getCharsForCast(castForIv), [characters, castForIv]);
  const charsForSp = useMemo(() => getCharsForCast(castForSp), [characters, castForSp]);

  // ── 当前章相关干预 ──
  const chapterPoolIvs = useMemo(() => {
    if (!activeChapterId) return [];
    return poolIvs.filter(iv => iv.chapterId === activeChapterId);
  }, [poolIvs, activeChapterId]);

  // ── 章节编辑同步 ──
  useEffect(() => {
    if (activeChapter) {
      setEditChTitle(activeChapter.title || '');
      setEditChPurpose(activeChapter.purpose || '');
      setEditChScene(activeChapter.scene || activeChapter.scene_prompt || '');
      setEditChSynopsis((activeChapter as any).synopsis || '');
      setEditChBeats(activeChapter.beats?.map(b => b.description).join('\n') || '');
      // 干预行跟随当前章切换
      setIvChapter(activeChapter.id);
      setSpChapter(activeChapter.id);
      setEvChapter(activeChapter.id);
      if (activeChapter.beats.length > 0) {
        setIvBeat(activeChapter.beats[0].id);
        setSpBeat(activeChapter.beats[0].id);
        setEvBeat(activeChapter.beats[0].id);
      }
    }
  }, [activeChapterId, activeChapter, chapters]);

  // ── 初始化下拉默认值（仅在无数据时） ──
  useEffect(() => {
    if (characters.length > 0 && !ivTarget) { const c = castForIv[0] || characters[0].id; setIvTarget(c); setSpTarget(c); }
  }, [characters]);

  const beatsFor = (chId: string) => chapters.find(c => c.id === chId)?.beats || [];
  const handleChChange = (chId: string, setBeat: (b: string) => void, setTarget?: (t: string) => void) => {
    const beats = beatsFor(chId);
    if (beats.length > 0) setBeat(beats[0].id);
    // 切换章后自动选中该章第一个出场人物
    if (setTarget) {
      const cast = getCastIds(chId);
      if (cast.length > 0) setTarget(cast[0]);
    }
  };

  // ── 添加到干预池 ──
  const addToPool = () => {
    const newIvs: PoolIntervention[] = [];
    const now = Date.now();
    if (ivContent.trim()) {
      const beat = beatsFor(ivChapter).find(b => b.id === ivBeat);
      newIvs.push({ type: 'thought', character: ivTarget, content: ivContent.trim(), chapterId: ivChapter, beatId: ivBeat, beatOrder: beat?.beat_order });
      setIvContent('');
    }
    if (spContent.trim()) {
      const beat = beatsFor(spChapter).find(b => b.id === spBeat);
      newIvs.push({ type: 'speech', character: spTarget, content: spContent.trim(), chapterId: spChapter, beatId: spBeat, beatOrder: beat?.beat_order });
      setSpContent('');
    }
    if (evContent.trim()) {
      const beat = beatsFor(evChapter).find(b => b.id === evBeat);
      newIvs.push({ type: 'event', content: evContent.trim(), chapterId: evChapter, beatId: evBeat, beatOrder: beat?.beat_order });
      setEvContent('');
    }
    if (newIvs.length > 0) setPoolIvs(prev => [...prev, ...newIvs]);
  };

  const removePoolIv = (idx: number) => setPoolIvs(prev => prev.filter((_, i) => i !== idx));
  const clearPool = () => setPoolIvs([]);

  // ── 执行表演 ──
  const doGenerate = async () => {
    if (!activeChapterId) return;
    completedChapters.current.delete(activeChapterId);
    setShowPerformConfirm(false);
    await generateChapter(activeChapterId, chapterPoolIvs, selectedDirector);
    setPoolIvs(prev => prev.filter(iv => iv.chapterId !== activeChapterId));
  };

  // ── 解析剧本 ──
  const handleParse = async () => {
    setParseError('');
    if (!scriptInput.trim()) { setParseError('脚本为空'); return; }
    setParsing(true); setParseProgress('正在解析章节结构...');
    try {
      const result = await parseScript(scriptInput, selectedEditor);
      if (!result.success) { setParseError('解析失败'); setParsing(false); return; }
      const parsed = result.data;
      if (!parsed) { setParseError('解析失败'); setParsing(false); return; }
      setParseProgress('正在保存章节...');
      const { chapters: parsedCh, characters: parsedChars, hasOverlap, overlapTitle } = parsed;
      if (hasOverlap) {
        setOverwriteConfirm({ chapters: parsedCh, characters: parsedChars, overlapTitle });
      } else {
        await saveParsedChapters(parsedCh, parsedChars);
        setScriptInput(''); setShowDesigner(false);
      }
    } catch (e: any) {
      setParseError(e.message || '解析失败');
    } finally {
      setParsing(false); setParseProgress('');
    }
  };

  const [overwriting, setOverwriting] = useState(false);
  const confirmOverwrite = async () => {
    if (!overwriteConfirm || overwriting) return;
    setOverwriting(true);
    try {
      await saveParsedChapters(overwriteConfirm.chapters, overwriteConfirm.characters);
      setScriptInput(''); setShowDesigner(false); setOverwriteConfirm(null);
    } catch (e: any) {
      console.error('Overwrite failed:', e);
      setParseError('覆盖失败：' + (e.message || '未知错误'));
    } finally {
      setOverwriting(false);
    }
  };

  const saveCharacter = async () => {
    if (!editingCharId) return;
    const ch = characters.find(c => c.id === editingCharId);
    if (!ch) return;
    await fetch('/api/characters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ch) });
    setShowCharEditor(false);
    await loadAll();
  };

  const updateCharField = (field: string, value: any) => {
    if (!editingCharId) return;
    useStore.setState(s => {
      const chars = s.characters.map(c => {
        if (c.id !== editingCharId) return c;
        if (field in c.personality) return { ...c, personality: { ...c.personality, [field]: value } };
        return { ...c, [field]: value };
      });
      return { characters: chars };
    });
  };

  const saveChapterEdit = async () => {
    if (!activeChapterId) return;
    const beats = editChBeats.split('\n').filter(l => l.trim()).map((desc, i) => ({
      id: `${activeChapterId}_b_${i + 1}`, beat_order: i + 1, order: i + 1,
      description: desc.trim(), status: 'pending', interventions: [],
    }));
    await updateChapter(activeChapterId, { title: editChTitle, purpose: editChPurpose, scene: editChScene, synopsis: editChSynopsis, beats, scene_prompt: editChScene, cast_list: JSON.stringify(activeCastIds) });
  };

  // ── 消息渲染 ──
  // 生成中：对话气泡排队打字（一个说完下一个才出现），其他即时显示并推进队列
  const renderMessage = (msg: any, isTyping = true, onDone?: () => void) => {
    // 第二道防线：narration 如果看起来是对话格式且有匹配角色，按 speech 渲染
    let effectiveType = msg.type;
    let effectiveCharId = msg.characterId || '';
    let effectiveContent = msg.content || '';
    if (msg.type === 'narration' && /^[^\s：:]{1,12}[：:]\s*.+/.test(msg.content)) {
      const pm = msg.content.match(/^([^\s：:]{1,12})[：:]\s*(.+)/);
      if (pm) {
        const chByName = characters.find((c: any) => c.name === pm[1] || c.id === pm[1] || c.name.endsWith(pm[1]) || pm[1].endsWith(c.name) || (pm[1].length >= 2 && c.name.includes(pm[1])));
        if (chByName) { effectiveType = 'speech'; effectiveCharId = chByName.id || pm[1]; effectiveContent = pm[2]; }
      }
    }
    const ch = getCharById(effectiveCharId || '');
    // 生成中且轮到本条消息，但本条不是对话 → 立刻完成，推进到下一个
    if (generating && isTyping && effectiveType !== 'speech' && onDone) {
      setTimeout(onDone, 0);
    }

    if (effectiveType === 'speech') {
      const actionMatch = effectiveContent.match(/^[（(]([^）)]+)[）)]\s*/);
      const action = actionMatch ? actionMatch[1] : null;
      const dialogue = actionMatch ? effectiveContent.slice(actionMatch[0].length) : effectiveContent;
      const isLongAction = action && action.length > 15;
      const charName = ch?.name || effectiveCharId || '';
      const dialogueSpeed = (generating || isTyping) ? 45 : 0;
      return (
        <div key={msg.id}>
          {isLongAction && (
            <div style={{ margin: '4px 0', padding: '8px 14px', fontSize: 12, lineHeight: 1.8, color: '#c8b0a0', borderLeft: '3px solid rgba(200,176,160,0.5)', borderRadius: '0 6px 6px 0', background: 'rgba(180,150,120,0.06)' }}>
              <Typewriter text={charName + action} speed={0} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '6px 0' }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, #2a2a3a, #1a1a2e)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>{ch?.emoji || '👤'}</div>
            <div style={{ maxWidth: '70%', minWidth: 80 }}>
              <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 4, color: ch ? ACCENT : TEXT_MUTED, letterSpacing: '0.03em' }}>{ch?.name || effectiveCharId || '???'}</div>
              {action && !isLongAction && (
                <div style={{ fontSize: 11, color: '#f0a8c0', fontStyle: 'italic', padding: '3px 4px 5px 4px', marginBottom: 2, lineHeight: 1.5 }}>
                  <Typewriter text={action} speed={0} />
                </div>
              )}
              <div style={{ position: 'relative', padding: '9px 13px', borderRadius: (action && !isLongAction) ? '2px 10px 10px 10px' : '4px 12px 12px 12px', background: BG_DARK, border: '1px solid rgba(255,255,255,0.08)', fontSize: 13, lineHeight: 1.85, color: '#e0ddf0' }}>
                <Typewriter text={dialogue} speed={dialogueSpeed} onDone={onDone} />
              </div>
            </div>
          </div>
        </div>
      );
    }
    // 非对话类型
    const sp = isTyping && !generating ? undefined : 0;
    if (msg.type === 'node_start') return (
      <div key={msg.id} id={msg.id} style={{ textAlign: 'center', fontSize: 10, color: 'rgba(34,211,238,0.6)', padding: '5px 0', fontWeight: 500, letterSpacing: '0.04em', borderTop: '1px solid rgba(34,211,238,0.08)', margin: '4px 0' }}>
        <Typewriter text={msg.content} speed={sp ?? 60} onDone={generating ? undefined : onDone} />
      </div>
    );
    if (msg.type === 'plot_progress') return (
      <div key={msg.id} style={{ textAlign: 'center', fontSize: 10, color: PINK, padding: '8px 0', fontWeight: 600, letterSpacing: '0.05em', background: 'linear-gradient(90deg, transparent, rgba(244,114,182,0.08), transparent)', margin: '8px 0', borderRadius: 4 }}>
        ✦ <Typewriter text={msg.content} speed={sp ?? 80} onDone={generating ? undefined : onDone} />
      </div>
    );
    if (msg.type === 'narration') return (
      <div key={msg.id} style={{ margin: '6px 0', padding: '10px 16px', fontSize: 12, lineHeight: 1.9, color: '#b0a8c8', borderLeft: '3px solid rgba(180,160,200,0.4)', borderRadius: '0 6px 6px 0', background: 'rgba(160,140,200,0.04)' }}>
        <Typewriter text={msg.content} speed={sp ?? 36} onDone={generating ? undefined : onDone} />
      </div>
    );
    if (msg.type === 'atmosphere') return (
      <div key={msg.id} style={{ padding: '6px 14px', fontSize: 12, color: '#9ca3af', textAlign: 'center', fontStyle: 'italic', borderTop: '1px dashed rgba(255,255,255,0.08)', borderBottom: '1px dashed rgba(255,255,255,0.08)', margin: '4px 0', letterSpacing: '0.02em' }}>
        <Typewriter text={msg.content} speed={sp ?? 60} onDone={generating ? undefined : onDone} />
      </div>
    );
    if (msg.type === 'event') {
      if (onDone) { setTimeout(onDone, 0); }
      return (
        <div key={msg.id} style={{ padding: '7px 16px', background: 'rgba(251,191,36,0.06)', border: `1px solid rgba(251,191,36,0.15)`, borderLeft: 'none', borderRight: 'none', fontSize: 12, color: AMBER, textAlign: 'center', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: msg.content }} />
      );
    }
    if (msg.type === 'micro_reaction') {
      if (onDone) { setTimeout(onDone, 0); }
      return (
        <div key={msg.id} style={{ fontSize: 9, color: TEXT_MUTED, fontStyle: 'italic', paddingLeft: 36, marginLeft: 14, borderLeft: `2px solid rgba(167,139,250,0.2)` }}>{msg.content}</div>
      );
    }
    if (onDone) { setTimeout(onDone, 0); }
    return <div key={msg.id} style={{ textAlign: 'center', fontSize: 11, color: TEXT_MUTED, padding: '4px 0' }}>{msg.content}</div>;
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "'Segoe UI', system-ui, sans-serif", background: '#0a0a0f' }}>
      {/* ═══════════ 左栏 260px ═══════════ */}
      <aside style={{ width: 260, minWidth: 260, background: BG_PANEL, borderRight: BORDER, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 14px', borderBottom: BORDER, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: TEXT_MUTED }}>👥 角色（{characters.length}人 · 出场{activeCastIds.length}人）</span>
          <button className="btn-icon" title="从MD文件读取/更新角色人格" onClick={async () => { await fetch('/api/reload-characters', { method: 'POST' }); await loadAll(); }}
            style={{ width: 28, height: 28, borderRadius: 6, border: BORDER, background: 'transparent', color: TEXT_MUTED, cursor: 'pointer', fontSize: 13, lineHeight: '28px' }}>📂</button>
        </div>
        <div style={{ fontSize: 8, color: TEXT_MUTED, padding: '2px 14px' }}>点击角色卡片切换本章出场 · 红框=出场</div>
        <div style={{ flex: 1, overflow: 'auto', padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {characters.map(ch => {
            const st = states[ch.id];
            const mood = st?.mood ?? 50; const energy = st?.energy ?? 80; const impulse = st?.impulse ?? 30;
            const isInCast = activeCastIds.includes(ch.id) || activeCastIds.includes(ch.name);
            const toggleCast = async () => {
              if (!activeChapterId) return;
              const chp = chapters.find(c => c.id === activeChapterId);
              if (!chp) return;
              let newCast = [...activeCastIds];
              const matchById = newCast.includes(ch.id);
              const matchByName = newCast.includes(ch.name);
              if (matchById) { newCast = newCast.filter(x => x !== ch.id); }
              else if (matchByName) { newCast = newCast.filter(x => x !== ch.name); }
              else { newCast.push(ch.id); }
              await updateChapter(activeChapterId, { cast_list: JSON.stringify(newCast) });
            };
            return (
              <div key={ch.id} className="char-card" onClick={toggleCast} title="点击切换本章出场" style={{ padding: '8px 10px', borderRadius: 8, border: isInCast ? `2px solid ${RED}` : BORDER, background: 'rgba(255,255,255,0.01)', cursor: 'pointer', transition: 'border-color .15s', opacity: isInCast ? 1 : 0.5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: BG_INPUT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{ch.emoji || '👤'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, fontWeight: 700 }}>{ch.name}</div><div style={{ fontSize: 9, color: TEXT_MUTED }}>{ch.title}</div></div>
                  <button onClick={(e) => { e.stopPropagation(); setEditingCharId(ch.id); setShowCharEditor(true); }} style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid transparent', background: 'transparent', color: TEXT_MUTED, cursor: 'pointer', fontSize: 11, flexShrink: 0 }}>✎</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {[{ label: '情绪', val: Math.round(mood), color: TEAL }, { label: '精力', val: Math.round(energy), color: CYAN }, { label: '冲动', val: Math.round(impulse), color: ACCENT }].map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, color: TEXT_MUTED }}>
                      <span style={{ width: 22, textAlign: 'right', flexShrink: 0 }}>{s.label}</span>
                      <div style={{ flex: 1, height: 3, borderRadius: 10, background: '#27272a', overflow: 'hidden' }}><div style={{ width: `${s.val}%`, height: '100%', borderRadius: 10, background: s.color, transition: 'width 0.5s' }} /></div>
                      <span style={{ width: 18, textAlign: 'right', fontSize: 8, color: s.color }}>{s.val}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 4, paddingTop: 4, borderTop: BORDER, fontSize: 9, color: TEXT_MUTED, fontStyle: 'italic', lineHeight: 1.4 }}>{st?.inner_thought || ch.personality?.core?.slice(0, 40) + '…' || ''}</div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '8px 14px', borderTop: BORDER, fontSize: 9, color: TEXT_MUTED, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ opacity: 0.6 }}>📍 第{activeChapter?.chapter_order || '?'}章</span>
          <span>{activeChapter?.title?.slice(0, 14) || '—'}</span>
        </div>
      </aside>

      {/* ═══════════ 中栏 flex:1 ═══════════ */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '10px 20px', background: 'linear-gradient(135deg, rgba(30,30,50,0.95), rgba(15,15,20,0.95))', borderBottom: BORDER, textAlign: 'center', fontSize: 12, color: TEXT_SECONDARY, lineHeight: 1.6 }}>{plaza?.scene_description || '等待剧本加载…'}</div>
        <div style={{ padding: '5px 16px', borderBottom: BORDER, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: BG_DARK }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 9px', borderRadius: 16, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.15)', fontSize: 9, color: GREEN }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: GREEN, animation: generating ? 'pulse 1.5s infinite' : 'none' }} />{generating ? '生成中…' : activeChapterId ? 'LIVE' : '就绪'}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button onClick={async () => { setShowDesigner(true); setParseError(''); const r = await fetch('/api/editors'); const j = await r.json(); setEditors(j.data || []); }} className="action-btn" style={{ fontSize: 9, padding: '3px 9px', borderRadius: 4, border: BORDER, background: 'transparent', color: ACCENT, cursor: 'pointer' }}>📖 章节设计</button>
            <button onClick={async () => { const r = await fetch('/api/world'); const j = await r.json(); setWorldEdit(j.data || ''); setContentModalType('world'); setShowContentModal(true); }} className="action-btn" style={{ fontSize: 9, padding: '3px 9px', borderRadius: 4, border: BORDER, background: 'transparent', color: TEXT_SECONDARY, cursor: 'pointer' }}>🌍 世界观</button>
            <button onClick={async () => { const r = await fetch('/api/outline'); const j = await r.json(); setOutlineEdit(j.data || ''); setContentModalType('outline'); setShowContentModal(true); }} className="action-btn" style={{ fontSize: 9, padding: '3px 9px', borderRadius: 4, border: BORDER, background: 'transparent', color: TEXT_SECONDARY, cursor: 'pointer' }}>📋 大纲</button>
            <button onClick={() => activeChapterId && setShowPerformConfirm(true)} disabled={generating || !activeChapterId}
              style={{ fontSize: 9, padding: '3px 9px', borderRadius: 4, border: '1px solid rgba(74,222,128,0.3)', background: 'transparent', color: GREEN, cursor: generating || !activeChapterId ? 'not-allowed' : 'pointer', fontWeight: 700, opacity: generating || !activeChapterId ? 0.5 : 1 }}>▶ 开始表演</button>
            <button onClick={() => activeChapterId && setShowPerformConfirm(true)} disabled={generating || !activeChapterId}
              style={{ fontSize: 9, padding: '3px 9px', borderRadius: 4, border: '1px solid rgba(244,114,182,0.3)', background: 'transparent', color: PINK, cursor: generating || !activeChapterId ? 'not-allowed' : 'pointer', opacity: generating || !activeChapterId ? 0.5 : 1 }}>🔄 重新生成</button>
            <button className="action-btn" style={{ fontSize: 9, padding: '3px 9px', borderRadius: 4, border: BORDER, background: 'transparent', color: TEXT_SECONDARY, cursor: 'pointer' }}>⏯ 暂停</button>
            <span style={{ fontSize: 8, color: TEXT_MUTED, marginLeft: 4 }}>导演</span>
            <select value={selectedDirector} onChange={e => setSelectedDirector(e.target.value)}
              onClick={async () => { const r = await fetch('/api/directors'); const j = await r.json(); setDirectors(j.data || []); if (!selectedDirector) setSelectedDirector(j.data?.[0]?.id || 'default'); }}
              style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_SECONDARY, cursor: 'pointer', maxWidth: 80 }}>
              {directors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ padding: '4px 16px', background: BG_DARK, borderBottom: BORDER, display: 'flex', alignItems: 'center', gap: 5, fontSize: 8, color: TEXT_MUTED }}>
          <span>📌</span><div style={{ flex: 1, height: 2, borderRadius: 10, background: '#27272a', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 10, background: `linear-gradient(90deg, ${ACCENT_DIM}, ${ACCENT})`, width: `${totalBeats > 0 ? Math.round((doneBeats / totalBeats) * 100) : 0}%`, transition: 'width 0.5s' }} /></div><span>{doneBeats}/{totalBeats}</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '14px 24px 20px', display: 'flex', flexDirection: 'column', gap: 3, background: `radial-gradient(ellipse at 50% 20%, rgba(167,139,250,0.01) 0%, transparent 60%), ${BG_DARK}` }}>
          {messages.length === 0 && <div style={{ textAlign: 'center', color: TEXT_MUTED, padding: 40, fontSize: 12 }}>点击「开始表演」生成对话</div>}
          {messages.slice(0, typingIdx + 1).map((msg, i) => {
            const isTyping = i === typingIdx;
            const onThisDone = isTyping ? advanceTyping : undefined;
            return renderMessage(msg, isTyping, onThisDone);
          })}
          <div ref={msgEndRef} />
        </div>
        {/* ── 💉 注入念头 ── */}
        <div style={{ padding: '4px 12px', borderTop: BORDER, display: 'flex', gap: 5, alignItems: 'center', background: BG_DARK }}>
          <span style={{ width: 22, height: 22, borderRadius: 4, background: 'rgba(96,165,250,0.08)', color: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>💉</span>
          <select value={ivChapter} onChange={e => { setIvChapter(e.target.value); handleChChange(e.target.value, setIvBeat, setIvTarget); }} style={{ fontSize: 9, padding: '3px 4px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, outline: 'none' }}>{chapters.map(c => <option key={c.id} value={c.id}>第{c.chapter_order}章 {c.title.slice(0, 10)}</option>)}</select>
          <select value={ivBeat} onChange={e => setIvBeat(e.target.value)} style={{ fontSize: 9, padding: '3px 4px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, outline: 'none' }}>{beatsFor(ivChapter).map(b => <option key={b.id} value={b.id}>节点{b.beat_order}：{b.description.slice(0, 12)}</option>)}</select>
          <select value={ivTarget} onChange={e => setIvTarget(e.target.value)} style={{ fontSize: 9, padding: '3px 4px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, outline: 'none', width: 90, flexShrink: 0 }}>{charsForIv.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select>
          <input value={ivContent} onChange={e => setIvContent(e.target.value)} placeholder="注入念头…" style={{ flex: 1, minWidth: 100, padding: '4px 6px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 10, outline: 'none' }} />
        </div>
        {/* ── 🗣 强制发言 ── */}
        <div style={{ padding: '4px 12px', display: 'flex', gap: 5, alignItems: 'center', background: BG_DARK }}>
          <span style={{ width: 22, height: 22, borderRadius: 4, background: 'rgba(244,114,182,0.08)', color: PINK, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>🗣</span>
          <select value={spChapter} onChange={e => { setSpChapter(e.target.value); handleChChange(e.target.value, setSpBeat, setSpTarget); }} style={{ fontSize: 9, padding: '3px 4px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, outline: 'none' }}>{chapters.map(c => <option key={c.id} value={c.id}>第{c.chapter_order}章 {c.title.slice(0, 10)}</option>)}</select>
          <select value={spBeat} onChange={e => setSpBeat(e.target.value)} style={{ fontSize: 9, padding: '3px 4px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, outline: 'none' }}>{beatsFor(spChapter).map(b => <option key={b.id} value={b.id}>节点{b.beat_order}：{b.description.slice(0, 12)}</option>)}</select>
          <select value={spTarget} onChange={e => setSpTarget(e.target.value)} style={{ fontSize: 9, padding: '3px 4px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, outline: 'none', width: 90, flexShrink: 0 }}>{charsForSp.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}</select>
          <input value={spContent} onChange={e => setSpContent(e.target.value)} placeholder="强制发言…" style={{ flex: 1, minWidth: 100, padding: '4px 6px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 10, outline: 'none' }} />
        </div>
        {/* ── ⚡ 突发事件 ── */}
        <div style={{ padding: '4px 12px', display: 'flex', gap: 5, alignItems: 'center', background: BG_DARK }}>
          <span style={{ width: 22, height: 22, borderRadius: 4, background: 'rgba(251,191,36,0.08)', color: AMBER, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>⚡</span>
          <select value={evChapter} onChange={e => { setEvChapter(e.target.value); handleChChange(e.target.value, setEvBeat); }} style={{ fontSize: 9, padding: '3px 4px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, outline: 'none' }}>{chapters.map(c => <option key={c.id} value={c.id}>第{c.chapter_order}章 {c.title.slice(0, 10)}</option>)}</select>
          <select value={evBeat} onChange={e => setEvBeat(e.target.value)} style={{ fontSize: 9, padding: '3px 4px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, outline: 'none' }}>{beatsFor(evChapter).map(b => <option key={b.id} value={b.id}>节点{b.beat_order}：{b.description.slice(0, 12)}</option>)}</select>
          <input value={evContent} onChange={e => setEvContent(e.target.value)} placeholder="事件描述…" style={{ flex: 1, minWidth: 100, padding: '4px 6px', borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 10, outline: 'none' }} />
        </div>
        {/* ── 操作按钮行 ── */}
        <div style={{ padding: '5px 12px', borderTop: BORDER, display: 'flex', gap: 6, alignItems: 'center', background: BG_DARK, justifyContent: 'space-between' }}>
          <button onClick={addToPool} style={{ padding: '5px 14px', borderRadius: 4, border: 'none', background: ACCENT_DIM, color: 'white', fontSize: 10, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>+ 添加到待生效</button>
          <button onClick={() => setShowPool(true)} style={{ padding: '5px 12px', borderRadius: 4, border: BORDER, background: poolIvs.length > 0 ? 'rgba(167,139,250,0.1)' : 'transparent', color: poolIvs.length > 0 ? ACCENT : TEXT_MUTED, fontSize: 10, cursor: 'pointer', fontWeight: poolIvs.length > 0 ? 600 : 400 }}>📋 待生效 ({poolIvs.length})</button>
        </div>
      </main>

      {/* ═══════════ 右栏 270px ═══════════ */}
      <aside style={{ width: 270, minWidth: 270, background: BG_PANEL, borderLeft: BORDER, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {activeChapter && (
            <div style={{ padding: '8px 12px', borderBottom: BORDER }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: TEXT_MUTED, marginBottom: 5 }}>📝 章节结构编辑</div>
              <div style={{ fontSize: 8, color: TEXT_MUTED, marginBottom: 1 }}>章节名称</div>
              <input value={editChTitle} onChange={e => setEditChTitle(e.target.value)} style={{ width: '100%', padding: 4, borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 10, marginBottom: 4, outline: 'none' }} />
              <div style={{ fontSize: 8, color: TEXT_MUTED, marginBottom: 1 }}>章节目的</div>
              <input value={editChPurpose} onChange={e => setEditChPurpose(e.target.value)} style={{ width: '100%', padding: 4, borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 10, marginBottom: 4, outline: 'none' }} />
              <div style={{ fontSize: 8, color: TEXT_MUTED, marginBottom: 1 }}>场景描写</div>
              <input value={editChScene} onChange={e => setEditChScene(e.target.value)} style={{ width: '100%', padding: 4, borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 10, marginBottom: 4, outline: 'none' }} />
              <div style={{ fontSize: 8, color: TEXT_MUTED, marginBottom: 1 }}>情节节点（每行一个）</div>
              <textarea value={editChBeats} onChange={e => setEditChBeats(e.target.value)} style={{ width: '100%', padding: 4, borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 10, minHeight: 60, resize: 'vertical', marginBottom: 4, outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }} />
              <div style={{ fontSize: 8, color: TEXT_MUTED, marginBottom: 1 }}>故事梗概（≤100字）</div>
              <textarea value={editChSynopsis} onChange={e => { if (e.target.value.length <= 100) setEditChSynopsis(e.target.value); }} placeholder="概括本章核心情节…" style={{ width: '100%', padding: 4, borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 10, minHeight: 40, resize: 'vertical', marginBottom: 4, outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }} />
              <div style={{ fontSize: 7, color: TEXT_MUTED, textAlign: 'right', marginBottom: 4 }}>{editChSynopsis.length}/100</div>
              <button onClick={saveChapterEdit} style={{ width: '100%', padding: 4, borderRadius: 4, border: 'none', background: ACCENT_DIM, color: 'white', fontSize: 9, cursor: 'pointer', fontWeight: 600 }}>✅ 保存章节编辑</button>
            </div>
          )}
          <div style={{ padding: '8px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: TEXT_MUTED }}>📖 章节进度</span>
              {chapters.length > 0 && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {batchDeleteMode && selectedChapters.size > 0 && (
                    <button onClick={async () => { for (const id of selectedChapters) { await removeChapter(id); } setSelectedChapters(new Set()); setBatchDeleteMode(false); }}
                      style={{ fontSize: 8, padding: '2px 6px', borderRadius: 3, border: 'none', background: RED, color: 'white', cursor: 'pointer' }}>删除({selectedChapters.size})</button>
                  )}
                  <button onClick={() => { setBatchDeleteMode(!batchDeleteMode); setSelectedChapters(new Set()); }}
                    style={{ fontSize: 8, padding: '2px 6px', borderRadius: 3, border: BORDER, background: batchDeleteMode ? 'rgba(255,255,255,0.08)' : 'transparent', color: batchDeleteMode ? TEXT_PRIMARY : TEXT_MUTED, cursor: 'pointer' }}>
                    {batchDeleteMode ? '取消' : '批量删除'}
                  </button>
                </div>
              )}
            </div>
            {chapters.map((ch, ci) => (
              <div key={ch.id} style={{ marginBottom: 6, opacity: ch.id === activeChapterId ? 1 : 0.5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {batchDeleteMode && (
                    <input type="checkbox" checked={selectedChapters.has(ch.id)} onChange={e => { const ns = new Set(selectedChapters); e.target.checked ? ns.add(ch.id) : ns.delete(ch.id); setSelectedChapters(ns); }}
                      style={{ width: 12, height: 12, cursor: 'pointer', flexShrink: 0, accentColor: RED }} />
                  )}
                  <div style={{ flex: 1, fontSize: 10, fontWeight: 600, color: ch.id === activeChapterId ? ACCENT : TEXT_PRIMARY, cursor: 'pointer' }} onClick={() => batchDeleteMode ? null : switchChapter(ch.id)}>{ci === 0 ? '✦ ' : '· '}第{ch.chapter_order}章：{ch.title}</div>
                  {!batchDeleteMode && (
                    <button onClick={(e) => { e.stopPropagation(); setDeleteChConfirm(ch.id); }} title="删除此章" style={{ width: 16, height: 16, borderRadius: 3, border: 'none', background: 'transparent', color: TEXT_MUTED, cursor: 'pointer', fontSize: 12, lineHeight: '14px', padding: 0, opacity: 0.5, flexShrink: 0 }}>×</button>
                  )}
                </div>
                <div style={{ paddingLeft: 6, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {ch.beats.map(b => {
                    const cls = b.status === 'done' ? GREEN : b.status === 'active' ? ACCENT : TEXT_MUTED;
                    const dotBg = b.status === 'done' ? GREEN : b.status === 'active' ? ACCENT : '#27272a';
                    const beatMsgId = `node_start_${b.id}`;
                    return <div key={b.id} onClick={() => { document.getElementById(beatMsgId)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} style={{ fontSize: 8, color: cls, display: 'flex', alignItems: 'center', gap: 3, lineHeight: 1.4, cursor: 'pointer', padding: '1px 2px', borderRadius: 2 }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'} title="点击跳转到此节点"><span style={{ width: 4, height: 4, borderRadius: '50%', background: dotBg, flexShrink: 0 }} />节点{b.beat_order}：{b.description}</div>;
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* ═══════════ 弹窗：表演确认 ═══════════ */}
      {showPerformConfirm && activeChapter && (
        <div onClick={e => e.target === e.currentTarget && setShowPerformConfirm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110 }}>
          <div style={{ width: 420, background: BG_PANEL, border: BORDER, borderRadius: 10, boxShadow: '0 16px 48px rgba(0,0,0,0.5)', padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>▶ 确认开始表演</div>
            <div style={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 1.8, marginBottom: 6 }}>
              将生成 <b style={{ color: ACCENT }}>第{activeChapter.chapter_order}章「{activeChapter.title}」</b> 的表演。
            </div>
            <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 4 }}>目的：{activeChapter.purpose?.slice(0, 50)}</div>
            <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 4 }}>节点数：{activeChapter.beats.length} | 场景：{activeChapter.scene?.slice(0, 30)}</div>
            <div style={{ fontSize: 10, color: chapterPoolIvs.length > 0 ? ACCENT : TEXT_MUTED, marginBottom: 16 }}>
              待生效干预：{chapterPoolIvs.length > 0 ? `${chapterPoolIvs.length} 条` : '无'}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowPerformConfirm(false)} style={{ padding: '6px 14px', borderRadius: 4, border: BORDER, background: 'transparent', color: TEXT_SECONDARY, cursor: 'pointer', fontSize: 11 }}>否</button>
              <button onClick={doGenerate} style={{ padding: '6px 18px', borderRadius: 4, border: 'none', background: GREEN, color: '#000', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>是，开始生成</button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════ 弹窗：干预池 ═══════════ */}
      {showPool && (
        <div onClick={e => e.target === e.currentTarget && setShowPool(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110 }}>
          <div style={{ width: 500, maxHeight: '80vh', background: BG_PANEL, border: BORDER, borderRadius: 10, boxShadow: '0 16px 48px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px', borderBottom: BORDER, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 700 }}>
              <span>📋 待生效干预 ({poolIvs.length})</span>
              <button onClick={() => setShowPool(false)} style={{ background: 'none', border: 'none', color: TEXT_MUTED, fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 12, background: BG_DARK }}>
              {poolIvs.length === 0 && <div style={{ textAlign: 'center', color: TEXT_MUTED, padding: 30, fontSize: 11 }}>暂无干预</div>}
              {poolIvs.map((iv, i) => {
                const ch = chapters.find(c => c.id === iv.chapterId);
                const beat = chapters.flatMap(c => c.beats).find(b => b.id === iv.beatId);
                const charName = characters.find(c => c.id === iv.character)?.name || iv.character || '';
                return (
                  <div key={i} style={{ marginBottom: 4, padding: '6px 8px', borderRadius: 4, border: BORDER, background: BG_INPUT, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontSize: 9, lineHeight: 1.5 }}>
                      <span style={{ color: iv.type === 'thought' ? BLUE : iv.type === 'speech' ? PINK : AMBER, fontWeight: 600 }}>
                        {iv.type === 'thought' ? '💉' : iv.type === 'speech' ? '🗣' : '⚡'} 第{ch?.chapter_order}章 节点{iv.beatOrder}
                        {iv.type !== 'event' ? ` → ${charName}` : ''}
                      </span>
                      <div style={{ color: TEXT_SECONDARY, marginTop: 2 }}>{iv.content}</div>
                    </div>
                    <button onClick={() => removePoolIv(i)} style={{ background: 'none', border: 'none', color: TEXT_MUTED, cursor: 'pointer', fontSize: 12, padding: '0 4px' }}>×</button>
                  </div>
                );
              })}
            </div>
            {poolIvs.length > 0 && (
              <div style={{ padding: '8px 14px', borderTop: BORDER, display: 'flex', justifyContent: 'flex-end' }}>
                <button onClick={clearPool} style={{ padding: '5px 14px', borderRadius: 4, border: BORDER, background: 'transparent', color: RED, cursor: 'pointer', fontSize: 10 }}>清空全部</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═════ 其余弹窗（章节设计器、覆盖确认、角色编辑器）保持不变 ═════ */}
      {showDesigner && (
        <div onClick={e => e.target === e.currentTarget && setShowDesigner(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ width: 800, maxHeight: '88vh', background: BG_PANEL, border: BORDER, borderRadius: 10, display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '10px 16px', borderBottom: BORDER, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 700 }}><span>📖 章节设计</span><button onClick={() => { setShowDesigner(false); setParseError(''); }} style={{ background: 'none', border: 'none', color: TEXT_MUTED, fontSize: 18, cursor: 'pointer' }}>✕</button></div>
            <div style={{ flex: 1, overflow: 'auto', padding: 14, background: BG_DARK, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, color: TEXT_MUTED }}>粘贴任意文本 · AI 将自动解析为结构化章节数据。⚠️ 文本中必须包含「第X章」字样。</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: TEXT_MUTED, whiteSpace: 'nowrap' }}>✎ 编辑风格：</span>
                {editors.map(ed => <button key={ed.id} onClick={() => setSelectedEditor(ed.id)} title={ed.desc} style={{ padding: '3px 10px', borderRadius: 12, border: selectedEditor === ed.id ? `1px solid ${ACCENT}` : BORDER, background: selectedEditor === ed.id ? 'rgba(167,139,250,0.1)' : 'transparent', color: selectedEditor === ed.id ? ACCENT : TEXT_SECONDARY, fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap' }}>{ed.name}</button>)}
              </div>
              <textarea value={scriptInput} onChange={e => setScriptInput(e.target.value)} placeholder="自由文本 / MD 格式均可，必须包含第X章：&#10;&#10;## 第一章：完美秘书的日常&#10;**目的**：展示极端自律与压抑&#10;**场景**：清晨办公室&#10;**情节**：&#10;- 早晨仪式感日常&#10;- 帮助同事却保持距离&#10;**人物A**：陈都灵，主角，极端自律&#10;&#10;## 第二章：暴雨夜的意外&#10;..." style={{ minHeight: 300, padding: 12, borderRadius: 6, border: parseError ? `1px solid ${RED}` : BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 11, fontFamily: "'Cascadia Code', Consolas, monospace", lineHeight: 1.7, resize: 'vertical', outline: 'none' }} />
              {parseError && <div style={{ color: RED, fontSize: 10, padding: '4px 8px', background: 'rgba(248,113,113,0.08)', borderRadius: 4, border: '1px solid rgba(248,113,113,0.2)' }}>{parseError}</div>}
              <button onClick={handleParse} disabled={parsing}
                style={{ alignSelf: 'flex-start', padding: '8px 20px', borderRadius: 6, border: 'none', background: parsing ? '#555' : ACCENT_DIM, color: 'white', fontSize: 12, fontWeight: 600, cursor: parsing ? 'not-allowed' : 'pointer', opacity: parsing ? 0.7 : 1 }}>
                {parsing ? `⏳ ${parseProgress}` : '🔍 AI 解析并生成章节设计'}
              </button>
              <div style={{ fontSize: 9, color: TEXT_MUTED, lineHeight: 1.5 }}>支持：① MD 格式 ② 自由文本（AI 推断）③ 纯关键词 · AI 高级编辑会优化章节名和人物性格</div>
            </div>
            <div style={{ padding: '8px 14px', borderTop: BORDER, display: 'flex', justifyContent: 'flex-end', gap: 5, alignItems: 'center' }}><button onClick={() => { setShowDesigner(false); setParseError(''); }} style={{ padding: '5px 14px', borderRadius: 4, border: BORDER, background: 'transparent', color: TEXT_SECONDARY, cursor: 'pointer', fontSize: 10 }}>取消</button><button onClick={() => setShowDesigner(false)} style={{ padding: '5px 18px', borderRadius: 4, border: 'none', background: ACCENT_DIM, color: 'white', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>✅ 保存</button></div>
          </div>
        </div>
      )}
      {/* ═══════════ 弹窗：世界观 / 大纲编辑 ═══════════ */}
      {showContentModal && (
        <div onClick={e => e.target === e.currentTarget && setShowContentModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ width: 760, maxHeight: '88vh', background: BG_PANEL, border: BORDER, borderRadius: 10, display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
            <div style={{ padding: '12px 18px', borderBottom: BORDER, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>
                {contentModalType === 'world' ? '🌍 世界观设定' : '📋 故事大纲'}
              </span>
              <button onClick={() => setShowContentModal(false)} style={{ background: 'none', border: 'none', color: TEXT_MUTED, fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 16, background: BG_DARK }}>
              <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 8 }}>
                {contentModalType === 'world'
                  ? '设定故事的世界背景。填写后，解析章节和生成表演时会自动注入作为上下文约束。'
                  : '故事主线走向。给 AI 方向性指引，越粗越有随机性。解析章节时会参考大纲确保前后连贯。'}
              </div>
              <textarea
                value={contentModalType === 'world' ? worldEdit : outlineEdit}
                onChange={e => contentModalType === 'world' ? setWorldEdit(e.target.value) : setOutlineEdit(e.target.value)}
                placeholder={contentModalType === 'world'
                  ? '# 世界观设定\n\n## 时代与地点\n\n## 社会背景\n\n## 核心冲突\n\n## 特殊规则\n\n## 叙事基调'
                  : '# 故事大纲\n\n## 主线概要\n\n## 篇章结构\n\n- 觉醒篇（1-5章）：...\n- 反抗篇（6-10章）：...'}
                style={{ width: '100%', padding: 14, borderRadius: 6, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 13, fontFamily: "'Cascadia Code', Consolas, monospace", lineHeight: 1.8, minHeight: 420, resize: 'vertical', outline: 'none' }}
              />
            </div>
            <div style={{ padding: '10px 18px', borderTop: BORDER, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button onClick={() => setShowContentModal(false)} style={{ padding: '6px 16px', borderRadius: 4, border: BORDER, background: 'transparent', color: TEXT_SECONDARY, cursor: 'pointer', fontSize: 11 }}>取消</button>
              <button onClick={async () => {
                if (contentModalType === 'world') await saveWorld(worldEdit);
                else await saveOutline(outlineEdit);
                setShowContentModal(false);
              }} style={{ padding: '6px 22px', borderRadius: 4, border: 'none', background: ACCENT_DIM, color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>💾 保存</button>
            </div>
          </div>
        </div>
      )}

      {/* ═════ 弹窗：删除章节确认 ═════ */}
      {deleteChConfirm && (() => {
        const ch = chapters.find(c => c.id === deleteChConfirm);
        return (
          <div onClick={e => e.target === e.currentTarget && setDeleteChConfirm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110 }}>
            <div style={{ width: 400, background: BG_PANEL, border: BORDER, borderRadius: 10, boxShadow: '0 16px 48px rgba(0,0,0,0.5)', padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>🗑 删除章节</div>
              <div style={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 1.6, marginBottom: 6 }}>
                确认删除 <b style={{ color: RED }}>第{ch?.chapter_order}章「{ch?.title}」</b>？
              </div>
              <div style={{ fontSize: 10, color: TEXT_MUTED, marginBottom: 16 }}>
                该章的所有消息和节点数据将被永久删除。此操作不可撤销。
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setDeleteChConfirm(null)} style={{ padding: '6px 14px', borderRadius: 4, border: BORDER, background: 'transparent', color: TEXT_SECONDARY, cursor: 'pointer', fontSize: 11 }}>取消</button>
                <button onClick={async () => { await removeChapter(deleteChConfirm); setDeleteChConfirm(null); }} style={{ padding: '6px 18px', borderRadius: 4, border: 'none', background: RED, color: 'white', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>确认删除</button>
              </div>
            </div>
          </div>
        );
      })()}

      {overwriteConfirm && (
        <div onClick={e => e.target === e.currentTarget && setOverwriteConfirm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110 }}>
          <div style={{ width: 420, background: BG_PANEL, border: BORDER, borderRadius: 10, boxShadow: '0 16px 48px rgba(0,0,0,0.5)', padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>⚠️ 确认覆盖</div>
            <div style={{ fontSize: 12, color: TEXT_SECONDARY, lineHeight: 1.6, marginBottom: 16 }}>数据库中已存在章节「<b style={{ color: ACCENT }}>{overwriteConfirm.overlapTitle}</b>」。<br />确认要覆盖该章节吗？</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button onClick={() => setOverwriteConfirm(null)} style={{ padding: '6px 14px', borderRadius: 4, border: BORDER, background: 'transparent', color: TEXT_SECONDARY, cursor: 'pointer', fontSize: 11 }}>取消</button><button onClick={confirmOverwrite} disabled={overwriting} style={{ padding: '6px 18px', borderRadius: 4, border: 'none', background: overwriting ? '#555' : RED, color: 'white', cursor: overwriting ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 600 }}>{overwriting ? '⏳ 覆盖中...' : '确认覆盖'}</button></div>
          </div>
        </div>
      )}
      {showCharEditor && editingCharId && (() => {
        const ch = characters.find(c => c.id === editingCharId);
        if (!ch) return null;
        const sliderDefs: { key: string; label: string }[] = [{ key: 'humorLevel', label: '幽默' }, { key: 'aggression', label: '攻击' }, { key: 'emotionalVolatility', label: '波动' }, { key: 'baseImpulse', label: '冲动' }, { key: 'socialTendency', label: '社交' }];
        return (
          <div onClick={e => e.target === e.currentTarget && setShowCharEditor(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ width: 580, maxHeight: '88vh', background: BG_PANEL, border: BORDER, borderRadius: 10, display: 'flex', flexDirection: 'column', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }}>
              <div style={{ padding: '10px 16px', borderBottom: BORDER, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 700 }}><span>✎ 编辑角色 · {ch.name}</span><button onClick={() => setShowCharEditor(false)} style={{ background: 'none', border: 'none', color: TEXT_MUTED, fontSize: 18, cursor: 'pointer' }}>✕</button></div>
              <div style={{ flex: 1, overflow: 'auto', padding: 14, background: BG_DARK, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div><div style={{ fontSize: 9, color: TEXT_MUTED, marginBottom: 2 }}>名称 / 称号</div><div style={{ display: 'flex', gap: 5 }}><input value={ch.name} onChange={e => updateCharField('name', e.target.value)} style={{ flex: 1, padding: 7, borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 11, outline: 'none' }} /><input value={ch.title} onChange={e => updateCharField('title', e.target.value)} style={{ flex: 1, padding: 7, borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 11, outline: 'none' }} /></div></div>
                <div><div style={{ fontSize: 9, color: TEXT_MUTED, marginBottom: 2 }}>外貌描写</div><textarea value={ch.appearance} onChange={e => updateCharField('appearance', e.target.value)} style={{ width: '100%', padding: 7, borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 11, minHeight: 40, resize: 'vertical', outline: 'none', fontFamily: 'inherit' }} /></div>
                <div><div style={{ fontSize: 9, color: TEXT_MUTED, marginBottom: 4 }}>人格参数</div>{sliderDefs.map(sd => (<div key={sd.key} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 1 }}><label style={{ width: 48, fontSize: 9, color: TEXT_SECONDARY, textAlign: 'right', flexShrink: 0 }}>{sd.label}</label><input type="range" min={0} max={100} value={(ch.personality as any)[sd.key] ?? 50} onChange={e => updateCharField(sd.key, +e.target.value)} style={{ flex: 1, accentColor: ACCENT_DIM, height: 3 }} /><span style={{ width: 18, fontSize: 9, color: ACCENT, textAlign: 'center' }}>{(ch.personality as any)[sd.key] ?? 50}</span></div>))}</div>
                <div><div style={{ fontSize: 9, color: TEXT_MUTED, marginBottom: 2 }}>人物设定</div><textarea value={ch.systemPrompt} onChange={e => updateCharField('systemPrompt', e.target.value)} style={{ width: '100%', padding: 7, borderRadius: 4, border: BORDER, background: BG_INPUT, color: TEXT_PRIMARY, fontSize: 10, minHeight: 160, resize: 'vertical', outline: 'none', fontFamily: 'monospace', lineHeight: 1.5 }} /></div>
              </div>
              <div style={{ padding: '8px 14px', borderTop: BORDER, display: 'flex', justifyContent: 'flex-end', gap: 5, alignItems: 'center' }}><button onClick={() => setShowCharEditor(false)} style={{ padding: '5px 14px', borderRadius: 4, border: BORDER, background: 'transparent', color: TEXT_SECONDARY, cursor: 'pointer', fontSize: 10 }}>取消</button><button onClick={saveCharacter} style={{ padding: '5px 18px', borderRadius: 4, border: 'none', background: ACCENT_DIM, color: 'white', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>✅ 保存</button></div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
