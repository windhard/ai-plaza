# AI 广场 v3 — CLAUDE.md

## 项目是什么

AI 导演剧场：用户写剧本大纲 → AI 解析 → AI 导演调用 LLM 生成完整表演（对话+叙事）→ 浏览器打字机动画展示。

## 启动方式

```bash
# 后端（端口 3001）
cd server && node src/index.js

# 前端（端口 5173）
cd client && npx vite --port 5173

# 浏览器打开 http://localhost:5173
```

## 文件结构速查

```
data/
├── world.md           ← 世界观设定（人写，可选）
├── outline.md         ← 故事大纲（人写，可选）
├── chapters/          ← 每章 .md（人写 + AI解析产出）
├── characters/        ← 角色 .md，YAML frontmatter 存人格参数
├── directors/         ← 导演风格 .md
├── editors/           ← 编辑人格 .md
└── plaza.json         ← 运行时状态（机器管，不手动编辑）

server/src/
├── index.js           ← Express 入口
├── routes/index.js    ← 所有 API
├── db/index.js        ← MD文件 + JSON 混合数据库
├── director/index.js  ← 导演 prompt 构建 + LLM 调用
├── parser.js          ← 剧本解析引擎
├── characterPool.js   ← 角色池 + MD 读写
└── llm/index.js       ← LLM 调用封装（thinking: disabled）

client/src/
├── App.tsx            ← 全部前端 UI
├── store/plazaStore.ts ← Zustand 状态管理
└── types/index.ts     ← TypeScript 类型
```

## 关键设计决策

- 一章 = 一次 LLM 调用（整章上下文好，不拆节点）
- JSON 只存运行态，人编辑的内容全部 .md 化
- 角色人格参数存在 .md 的 YAML frontmatter 里
- LLM 调用关闭了思考模式（thinking: disabled），速度更快
- API Key 在 `server/.env`

## 本次会话完成的改动

- 数据层重构：章节/角色从 plaza.json 拆到独立 .md 文件
- 新增世界观 (world.md) 和大纲 (outline.md)
- 章节删除功能
- 干预行人物过滤（只显示对应章的出场角色）
- LLM 调用关闭思考模式
- 清理了 24 个临时/重复文件
- 修复导演/编辑重复显示
