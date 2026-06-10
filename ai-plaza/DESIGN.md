# AI 广场 v3 — 设计文档

> 最后更新：2026-06-05
> 目标读者：接手此项目的 AI / 开发者
> 读完本文即可理解全部架构决策

---

## 1. 项目是什么

**AI 广场**是一个"AI 导演 + AI 演员"的对话生成剧场。

- **输入**：用户用自然语言（MD / 自由文本）描述一个故事的章节结构（章节名、目的、场景、情节节点、出场人物）
- **处理**：AI 解析剧本 → AI 导演一次性生成整章表演（对话 + 叙事 + 氛围）
- **输出**：浏览器中以打字机动画逐条呈现的角色对话、动作描写、场景氛围

核心场景：用户编写黑暗堕落题材的互动小说，AI 扮演"导演"指挥 AI 角色进行表演。

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    Browser (port 5173)               │
│  React + TypeScript + Tailwind + Zustand            │
│  ┌─────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ 左栏    │  │   中栏        │  │  右栏          │  │
│  │ 角色状态 │  │  消息瀑布流   │  │  章节结构编辑  │  │
│  │ 人格条   │  │  打字机动画   │  │  干预行(3行)  │  │
│  │         │  │              │  │  干预池弹窗    │  │
│  └─────────┘  └──────────────┘  └───────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │ REST API (JSON)
┌──────────────────────┴──────────────────────────────┐
│                  Server (port 3001)                   │
│  Express + CORS                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ routes/  │ │ director │ │ db/ (JSON file store) │ │
│  │ REST API │ │ 导演模块  │ │ plaza.json           │ │
│  └──────────┘ └────┬─────┘ └──────────────────────┘ │
│                    │                                  │
│  ┌──────────┐ ┌────┴─────┐ ┌──────────────────────┐ │
│  │ parser   │ │ llm/     │ │ characterPool        │ │
│  │ 剧本解析  │ │ LLM调用   │ │ 角色池 (Map + MD)    │ │
│  └──────────┘ └────┬─────┘ └──────────────────────┘ │
└────────────────────┼────────────────────────────────┘
                     │ HTTP (fetch)
┌────────────────────┴──────────────────────────────────┐
│              DeepSeek API                              │
│         https://api.deepseek.com/v1/chat/completions   │
└───────────────────────────────────────────────────────┘
```

---

## 3. 数据流

### 3.1 剧本解析流程

```
用户粘贴文本
  │
  ▼
POST /api/parse-script
  │
  ├─ 1. validateChapters()  — 必须含「第X章」
  ├─ 2. regexParse()        — 正则提取 MD 结构
  │     ├─ splitChapters()  — 按「## 第X章」分块
  │     ├─ extractField()   — 提取目的/场景
  │     ├─ extractBeats()   — 提取情节节点
  │     └─ extractCharacters() — 提取人物
  ├─ 3. llmEnhanceParse()   — LLM 增强（可选）
  │     └─ 仅当 LLM 节点数 ≥ regex 节点数才采用
  └─ 4. aiSeniorEdit()      — AI 编辑润色（根据 editor 人格）
        └─ 加载 data/editors/{id}.md 的提示词
  │
  ▼
返回 parsed chapters + characters（JSON）
  │
  ▼
前端展示覆盖确认（如已有同号章节）→ 用户确认 → POST /api/save-chapters
```

### 3.2 表演生成流程

```
用户点击「▶ 开始表演」
  │
  ▼
POST /api/generate { chapterId, poolInterventions, director }
  │
  ├─ 1. clearMessages(chapterId)     — 清除旧消息
  ├─ 2. 加载章节 + 节点 + 角色人格   — 从 DB / MD 文件
  ├─ 3. 合并干预                     — 数据库干预 + 前端池干预
  ├─ 4. 构建完整 prompt              — 章节信息 + 人物 + 干预 + 导演风格
  ├─ 5. llmCall() → DeepSeek API     — 单次调用，maxTokens=12000
  └─ 6. parseFullPerformance()       — 解析 LLM 输出为消息数组
        ├─ 识别节点标记【节点N】
        ├─ 识别对话行"角色名：内容"
        ├─ 识别叙事/氛围段落
        ├─ 角色名模糊匹配（"老王"→"保安老王"）
        └─ 兜底格式（角色名，动作）台词
  │
  ▼
消息数组 → insertMessages() → 返回前端
  │
  ▼
前端打字机动画依次展示
```

### 3.3 数据持久化

- **存储**：单文件 JSON（`data/plaza.json`），非 SQLite
- **原因**：简单、可读、迁移方便、AI 可直接编辑
- **结构**：`{ chapters, beats, characters, characterStates, messages, plaza }`
- **角色文件**：同时输出为 `data/characters/{id}.md`，支持 📂 按钮从 MD 重载

---

## 4. 关键模块

### 4.1 数据库层 (`server/src/db/index.js`)

纯函数式 JSON 文件 CRUD：

| 函数 | 用途 |
|------|------|
| `findAllChapters()` | 获取所有章节（按 chapter_order 排序） |
| `findBeats(chapterId)` | 获取某章的所有节点 |
| `upsertBeat(beat)` | 按 chapter_id + beat_order 去重覆盖 |
| `findAllMessages(chapterId)` | 获取某章消息（可选过滤） |
| `insertMessages(msgs)` | 批量插入消息 |
| `getPlaza()` / `updatePlaza()` | 广场全局状态 |

### 4.2 导演模块 (`server/src/director/index.js`)

一章 = 一次 LLM 调用。核心设计：

- **输入聚合**：章节元信息 + 所有节点 + 所有人物人格 + 数据库干预 + 前端池干预 → 一个巨型 system prompt
- **输出解析**：`parseFullPerformance()` 逐行解析 LLM 输出，识别节点标记、对话行、叙事段
- **角色匹配**：支持简称匹配（如"都灵"→"陈都灵"、"老王"→"保安老王"）
- **兜底解析**：支持 `（角色名，动作）台词` 格式自动转为标准格式
- **导演人格**：从 `data/directors/{id}.md` 加载，注入 system prompt

### 4.3 LLM 调用 (`server/src/llm/index.js`)

- 封装 DeepSeek API 调用
- 超时 180 秒（长文本生成）
- 环境变量：`DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`
- 支持单次调用和批量并行调用

### 4.4 角色池 (`server/src/characterPool.js`)

- 内存 Map 缓存所有角色
- 从 `data/characters/*.md` 加载人格
- 自动生成新角色（启发式推断人格参数）
- 人格参数：aggression / emotionalVolatility / baseImpulse / socialTendency
- 修改角色后自动输出 MD 文件

### 4.5 剧本解析 (`server/src/parser.js`)

双重解析策略：
1. **Regex 优先**：快速提取 MD 结构，结果作为 baseline
2. **LLM 增强**：仅在 LLM 输出节点数 ≥ regex 节点数时才采用（防止丢数据）
3. **AI 编辑**：根据 `data/editors/{id}.md` 人格润色章节名和人物性格

### 4.6 前端状态管理 (`client/src/store/plazaStore.ts`)

- Zustand store，单一数据源
- `loadAll()` 一次性拉取角色/状态/章节/广场/消息
- 操作后自动 `loadAll()` 重载保持同步

---

## 5. API 路由一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/plaza` | 获取广场状态 |
| PATCH | `/api/plaza` | 更新广场状态 |
| GET | `/api/characters` | 获取所有角色 |
| POST | `/api/characters` | 创建/更新角色 |
| DELETE | `/api/characters/:id` | 删除角色 |
| GET | `/api/states` | 获取角色状态 |
| PATCH | `/api/states/:cid` | 更新角色状态 |
| GET | `/api/chapters` | 获取所有章节（含节点） |
| PUT | `/api/chapters/:id` | 更新章节（含节点替换） |
| GET | `/api/messages?chapterId=` | 获取消息 |
| POST | `/api/parse-script` | 解析剧本 |
| POST | `/api/generate` | 生成表演 |
| POST | `/api/save-chapters` | 保存解析结果 |
| POST | `/api/switch-chapter` | 切换当前章 |
| POST | `/api/seed` | 重置种子数据 |
| POST | `/api/reload-characters` | 从 MD 重载角色 |
| GET | `/api/editors` | 获取编辑列表 |
| GET | `/api/directors` | 获取导演列表 |

---

## 6. 文件结构

```
ai-plaza/
├── server/
│   ├── package.json          # Express + cors + dotenv
│   ├── .env                  # DEEPSEEK_API_KEY（gitignore）
│   ├── .env.example          # 模板
│   └── src/
│       ├── index.js          # Express 入口，端口 3001
│       ├── db/index.js       # JSON 文件数据库
│       ├── db/seed.js        # 种子数据
│       ├── routes/index.js   # 所有 API 路由
│       ├── director/index.js # 导演模块（prompt + 解析）
│       ├── llm/index.js      # LLM 调用封装
│       ├── parser.js         # 剧本解析引擎
│       ├── characterPool.js  # 角色池 + MD 读写
│       ├── test-runner.js    # 测试用例
│       ├── test-input.js     # 测试输入生成
│       └── types/index.js    # 类型定义
├── client/
│   ├── package.json          # React + Vite + Tailwind + Zustand
│   └── src/
│       ├── main.tsx          # React 入口
│       ├── App.tsx           # 主组件（~600行单文件）
│       ├── index.css         # 全局样式 + 动画
│       ├── store/plazaStore.ts  # Zustand 状态管理
│       └── types/index.ts    # TypeScript 类型
├── data/
│   ├── plaza.json            # 运行时数据库（单文件 JSON）
│   ├── editor-profile.md     # 默认编辑人格
│   ├── editors/              # 6 个 AI 编辑人格（.md）
│   │   ├── asi.md, laoqiang.md, shenyan.md,
│   │   ├── suwan.md, zhoumo.md
│   ├── directors/            # 3 个导演人格（.md）
│   │   ├── 默认导演.md, 暗黑导演.md, 情欲导演.md
│   └── characters/           # 角色人格文件（.md）
│       ├── 陈都灵.md, 李秘书.md, 小李.md, 小文.md,
│       ├── 保安老王.md, 前台小刘.md, 测试员.md,
│       ├── 审判恶魔.md, 植入者恶魔.md, 熔铸者恶魔.md,
│       └── 低阶触手群.md
├── DESIGN.md                 # 本文档
├── README.md                 # 使用说明（写给 AI）
├── TEST.md                   # 测试用例
├── MIGRATION.md              # 迁移指南
└── PROJECT_SNAPSHOT.md       # 历史快照
```

---

## 7. 关键设计决策

### 7.1 为什么一章一次 LLM 调用（不用节点级调用）

- **叙事连贯性**：整章一个 prompt，LLM 能看到完整上下文，角色对话更连贯
- **性能**：避免 N 次 API 调用的延迟叠加
- **成本**：单次 12000 token 的调用比 N 次小调用更可控

### 7.2 为什么用 JSON 文件数据库（不用 SQLite）

- **迁移简单**：拷贝一个文件即可
- **AI 可读**：AI 可以直接读写 plaza.json 做调试
- **无依赖**：不需要 sqlite3 native 模块
- **够用**：本项目数据量小（几十章、几百条消息）

### 7.3 为什么角色人格用 .md 文件存储

- **人类可编辑**：用任何编辑器打开就是 Markdown
- **AI 可消费**：可以直接作为 system prompt 的一部分
- **版本控制友好**：纯文本 diff

### 7.4 为什么前端是单文件 App.tsx（~600行）

- 项目规模小，功能内聚
- 减少文件间状态传递的复杂度
- 后续可拆分

### 7.5 为什么字符匹配用模糊匹配

LLM 输出的角色名可能写简称（"都灵"、"老王"），数据库存全名（"陈都灵"、"保安老王"）。`matchChar()` 函数做了双向包含匹配。

---

## 8. 消息类型系统

表演生成后解析为以下消息类型：

| type | 用途 | 前端渲染样式 |
|------|------|-------------|
| `atmosphere` | 场景氛围描写 | 灰色斜体，虚线边框 |
| `node_start` | 节点开始标记 | 青色，居中 |
| `speech` | 角色对话 | 气泡，带头像 + 名字 |
| `narration` | 叙事描写 | 青色左边框，半透明背景 |
| `plot_progress` | 节点完成标记 | 粉色，居中，渐隐背景 |
| `event` | 突发事件 | 琥珀色，强调边框 |

对话行格式：`角色名：（动作描写）对话内容` → 前端分离动作为紫色斜体，对话为正常文本。

---

## 9. 干预系统

两种干预方式：

1. **节点预置干预**（存数据库）：在章节结构中直接为某节点添加干预，生成时自动注入
2. **干预池**（前端临时）：在底部三行（💉注入/🗣发言/⚡事件）填写，点击"添加到待生效"，存放在前端 state 中，生成时一并传入

干预类型：
- `thought`：注入念头（让角色在特定节点产生某种想法）
- `speech`：强制发言（让角色必须说出某句话）
- `event`：突发事件（在特定节点触发意外事件）

---

## 10. 扩展点

- **新增 LLM Provider**：修改 `server/src/llm/index.js`，添加新 provider 分支
- **新增导演风格**：在 `data/directors/` 下创建新 `.md` 文件
- **新增编辑人格**：在 `data/editors/` 下创建新 `.md` 文件
- **新增角色**：在 `data/characters/` 下创建 `.md` 或通过 UI 创建
- **拆分前端组件**：将 `App.tsx` 拆为独立组件文件
