# AI 广场 v4 — AI 导演剧场

> 写剧本大纲 → AI 导演 + AI 演员生成完整表演 → 打字机动画展示

---

## 环境要求

- **Node.js** ≥ 18
- **npm**
- **DeepSeek API Key**（https://platform.deepseek.com 申请）

---

## 快速启动

```bash
# 1. 克隆项目
git clone https://github.com/windhard/ai-plaza.git
cd ai-plaza

# 2. 配置 API Key
cd server
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY

# 3. 安装依赖
npm install
cd ../client && npm install

# 4. 启动
cd ../server && node src/index.js        # 后端 → http://localhost:3001
# 新开终端
cd ../client && npx vite --port 5173     # 前端 → http://localhost:5173
```

浏览器打开 `http://localhost:5173`。

---

## 怎么用

1. 右栏「章节设计器」粘贴剧本大纲 → AI 解析章节/角色/节点
2. 左栏看到角色列表，可点击 ✎ 编辑角色性格和外貌
3. 选择导演风格（默认/暗黑/情欲）→ 点击「开始表演」
4. 中栏以打字机动画逐条展示对话和叙事

---

## 导演风格

| 导演 | 风格 |
|------|------|
| 默认导演 | 自然叙事，80%对话+20%叙事，日常克制 |
| 暗黑导演 | 黑暗堕落，权力关系，潜台词驱动 |
| 情欲导演 | 极致情欲，身体纪录片，多感官展开，支持地狱元素 |

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18 + Vite + TypeScript + Tailwind + Zustand |
| 后端 | Express 4 (Node.js) |
| LLM | DeepSeek API |
| 存储 | MD 文件 + JSON |

---

## 项目结构

```
data/
├── chapters/          ← 章节 MD（YAML frontmatter + 节点）
├── characters/        ← 角色 MD（YAML frontmatter 含人格参数）
├── directors/         ← 导演风格 MD
├── editors/           ← 编辑人格 MD
└── plaza.json         ← 运行时状态

server/src/
├── index.js           ← Express 入口
├── routes/index.js    ← 所有 API
├── director/index.js  ← 导演 prompt 构建 + 解析
├── llm/index.js       ← LLM 调用
├── parser.js          ← 剧本解析
└── db/index.js        ← 数据层

client/src/
├── App.tsx            ← 主 UI
├── store/plazaStore.ts ← 状态管理
└── types/index.ts     ← 类型定义
```
