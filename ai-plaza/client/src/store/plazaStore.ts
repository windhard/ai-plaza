import { create } from 'zustand';
import type { Character, CharacterState, Chapter, Message, PlazaState } from '../types';

interface Store {
  characters: Character[];
  states: Record<string, CharacterState>;
  chapters: Chapter[];
  messages: Message[];
  plaza: PlazaState | null;
  generating: boolean;
  activeChapterId: string | null;
  worldContent: string;
  outlineContent: string;

  loadAll: () => Promise<void>;
  parseScript: (script: string, editor?: string) => Promise<{ success: boolean; hasOverlap?: boolean; overlapTitle?: string; data?: any }>;
  saveParsedChapters: (chapters: any[], characters: any[]) => Promise<void>;
  setIntervention: (beatId: string, interventions: any[]) => Promise<void>;
  generateChapter: (chapterId: string, poolInterventions?: any[], director?: string) => Promise<void>;
  switchChapter: (chapterId: string) => Promise<void>;
  updateChapter: (chapterId: string, data: any) => Promise<void>;
  removeChapter: (chapterId: string) => Promise<void>;
  loadWorld: () => Promise<void>;
  saveWorld: (content: string) => Promise<void>;
  loadOutline: () => Promise<void>;
  saveOutline: (content: string) => Promise<void>;
}

// ═══ SSE 解析 ═══
function parseSSE(block: string): { event: string; data: any } | null {
  const lines = block.split('\n');
  let event = 'message';
  let dataStr = '';
  for (const line of lines) {
    if (line.startsWith('event: ')) event = line.slice(7);
    else if (line.startsWith('data: ')) dataStr = line.slice(6);
  }
  if (!dataStr) return null;
  try { return { event, data: JSON.parse(dataStr) }; }
  catch { return null; }
}

export const useStore = create<Store>((set, get) => ({
  characters: [], states: {}, chapters: [], messages: [],
  plaza: null, generating: false, activeChapterId: null,
  worldContent: '', outlineContent: '',

  loadAll: async () => {
    const [chars, states, chapters, plaza] = await Promise.all([
      fetch('/api/characters').then(r => r.json()),
      fetch('/api/states').then(r => r.json()),
      fetch('/api/chapters').then(r => r.json()),
      fetch('/api/plaza').then(r => r.json()),
    ]);
    const cid = plaza.data?.current_chapter_id || null;
    let messages: Message[] = [];
    if (cid) {
      const msgRes = await fetch(`/api/messages?chapterId=${cid}`).then(r => r.json());
      messages = msgRes.data || [];
    }
    set({
      characters: chars.data || [],
      states: states.data || {},
      chapters: chapters.data || [],
      plaza: plaza.data || null,
      activeChapterId: cid,
      messages,
    });
  },

  parseScript: async (script, editor = 'default') => {
    const res = await fetch('/api/parse-script', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, editor }),
    });
    const json = await res.json();
    if (json.success) {
      return { success: true, hasOverlap: json.data.hasOverlap, overlapTitle: json.data.overlapTitle, data: json.data };
    }
    return { success: false };
  },

  saveParsedChapters: async (chapters, characters) => {
    await fetch('/api/save-chapters', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapters }),
    });
    for (const ch of characters) {
      await fetch('/api/characters', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ch),
      });
    }
    await get().loadAll();
  },

  setIntervention: async (beatId, interventions) => {
    await fetch(`/api/beats/${beatId}/interventions`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interventions }),
    });
  },

  generateChapter: async (chapterId, poolInterventions = [], director = 'default') => {
    set({ generating: true, messages: [] });

    try {
      const res = await fetch('/api/generate-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapterId, poolInterventions, director }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuf += decoder.decode(value, { stream: true });
        const blocks = sseBuf.split('\n\n');
        sseBuf = blocks.pop() || '';

        for (const block of blocks) {
          if (!block.trim()) continue;
          const parsed = parseSSE(block);
          if (!parsed) continue;

          switch (parsed.event) {
            case 'message':
              // 实时追加消息
              set((state) => ({ messages: [...state.messages, parsed.data] }));
              break;
            case 'done':
              set({ generating: false });
              get().loadAll();
              break;
            case 'error':
              set({ generating: false });
              break;
            case 'status':
              // 状态更新可忽略
              break;
          }
        }
      }
    } catch (e) {
      console.error('Generate stream error:', e);
      set({ generating: false });
    }
  },

  removeChapter: async (chapterId: string) => {
    await fetch(`/api/chapters/${chapterId}`, { method: 'DELETE' });
    await get().loadAll();
  },

  switchChapter: async (chapterId) => {
    const res = await fetch('/api/switch-chapter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapterId }),
    });
    const json = await res.json();
    if (json.success) {
      set({ activeChapterId: chapterId });
      await get().loadAll();
    }
  },

  updateChapter: async (chapterId, data) => {
    await fetch(`/api/chapters/${chapterId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await get().loadAll();
  },

  loadWorld: async () => {
    const res = await fetch('/api/world').then(r => r.json());
    set({ worldContent: res.data || '' });
  },

  saveWorld: async (content) => {
    await fetch('/api/world', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  },

  loadOutline: async () => {
    const res = await fetch('/api/outline').then(r => r.json());
    set({ outlineContent: res.data || '' });
  },

  saveOutline: async (content) => {
    await fetch('/api/outline', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  },
}));
