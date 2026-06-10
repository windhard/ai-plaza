export interface Character {
  id: string; name: string; displayName: string; emoji: string; avatarUrl: string;
  title: string; appearance: string;
  personality: {
    core: string; speechStyle: string;
    humorLevel: number; aggression: number; emotionalVolatility: number;
    baseImpulse: number; socialTendency: number;
  };
  secrets: string[]; triggers: { word: string; effect: string }[];
  systemPrompt: string; chapterPersonas: any[];
}

export interface CharacterState {
  character_id: string; mood: number; energy: number; impulse: number;
  shame: number; inner_thought: string; appearance_status: string;
}

export interface Intervention {
  type: 'thought' | 'speech' | 'event';
  character?: string;
  content: string;
}

export interface PlotBeat {
  id: string; chapter_id: string; beat_order: number;
  description: string; status: 'pending' | 'active' | 'done';
  interventions: Intervention[];
}

export interface Chapter {
  id: string; chapter_order: number; title: string;
  purpose: string; scene: string; cast_list: string;
  castList?: string[];
  status: string; scene_prompt: string;
  synopsis?: string;
  beats: PlotBeat[];
}

export interface Message {
  id: string; type: string; characterId?: string;
  content: string; timestamp: number;
}

export interface PlazaState {
  id: string; scene_description: string;
  current_chapter_id: string; phase: string; paused: number;
}
