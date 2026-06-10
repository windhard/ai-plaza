# AI 广场 v3 — README（写给 AI 接手者）

> 如果我（上一个 AI）不在了，请按本文档快速上手。

---

## 一句话概括

这是一个 **AI 导演剧场**：用户写剧本大纲 → AI 解析 → AI 导演调用 LLM 生成完整表演（对话+叙事）→ 浏览器打字机动画展示。

---

## 环境要求

- **Node.js** ≥ 18
- **npm**
- **DeepSeek API Key**（去 https://platform.deepseek.com 申请）

---

## 快速启动（3 步）

```bash
# 1. 配置 API Key
cd ai-plaza/server
cp .env.example .env
# 编辑 .env，填入你的 DEEPSEEK_API_KEY

# 2. 安装依赖
cd ../server && npm install
cd ../client && npm install

# 3. 启动
cd ../server && node src/index.js        # 后端 → http://localhost:3001
# 新开终端
cd ../client && npx vite --port 5173     # 前端 → http://localhost:5173
```

打开 `http://localhost:5173`，看到三栏布局即为成功。

---

## 项目文件导航（按阅读优先级）

| 文件 | 内容 | 何时读 |
|------|------|--------|
| `DESIGN.md` | 完整架构设计 | 首次接手必读 |
| `TEST.md` | 测试用例清单 | 修改代码后跑一遍 |
| `MIGRATION.md` | 迁移到新机器 | 迁移时读 |
| `PROJECT_SNAPSHOT.md` | 历史快照 | 了解项目演进 |
| `server/src/index.js` | Express 入口 | 改端口/加中间件 |
| `server/src/routes/index.js` | 所有 API | 加新接口 |
| `server/src/director/index.js` | 导演 prompt 构建 | 调 LLM 输出质量 |
| `server/src/db/index.js` | JSON 数据库 | 改数据结构 |
| `server/src/parser.js` | 剧本解析 | 支持新输入格式 |
| `server/src/characterPool.js` | 角色管理 | 改角色系统 |
| `client/src/App.tsx` | 全部前端 UI | 改界面 |
| `client/src/store/plazaStore.ts` | 状态管理 | 改数据流 |
| `data/plaza.json` | 运行时数据 | 调试数据问题 |

---

## 常见任务 SOP

### 任务 1：新增一个 API 接口

1. 在 `server/src/routes/index.js` 添加路由处理
2. 如需数据库操作，使用 `server/src/db/index.js` 的导出函数
3. 在前端 `plazaStore.ts` 添加对应的 store action
4. 在 App.tsx 添加触发按钮

### 任务 2：调整 LLM 生成的对话质量

1. 修改 `server/src/director/index.js` 中的 prompt 模板
2. 修改 LLM 参数（temperature / maxTokens）在 `llmCall()` 调用处
3. 如需换模型，修改 `server/.env` 的 `DEEPSEEK_MODEL`

### 任务 3：支持新的剧本输入格式

1. 修改 `server/src/parser.js` 的 `regexParse()` / `splitChapters()`
2. 添加对应的测试用例到 `test-runner.js`
3. 运行 `node src/test-runner.js` 验证

### 任务 4：新增导演风格

1. 在 `data/directors/` 下创建 `新导演.md`
2. 格式：`## 姓名` + `## 导演提示词`
3. 前端下拉自动发现（`GET /api/directors` 扫描目录）

### 任务 5：新增/修改角色

- **方式 A（UI）**：左栏点 ✎ → 编辑 → 保存
- **方式 B（直接编辑文件）**：编辑 `data/characters/{角色名}.md` → 点 📂 按钮重载
- **方式 C（API）**：`POST /api/characters`

### 任务 6：重置所有数据

```bash
# 浏览器或 curl
curl -X POST http://localhost:3001/api/reset
# 或 POST /api/clear（清空不播种）
```

---

## 调试技巧

### 查看数据库
```bash
# 直接读 JSON 文件
cat data/plaza.json | head -100
```

### 测试剧本解析（不需 API key）
```bash
cd server && node src/test-runner.js
```

### 查看 LLM 发送的 prompt
在 `server/src/director/index.js` 的 `llmCall()` 前加：
```js
console.log('=== PROMPT ===', prompt.slice(0, 500));
```

### 前端调试
浏览器 DevTools → React DevTools → 查看 Zustand store 状态

---

## 数据备份

只需要拷贝 `data/` 目录：

```bash
cp -r data/ backup-$(date +%Y%m%d)/
```

核心文件是 `data/plaza.json`（所有运行时数据）。

---

## 已知限制

1. **单文件前端**：App.tsx ~600 行，功能多了需要拆分组件
2. **JSON 数据库**：数据量大（>1000章）时考虑迁移 SQLite
3. **仅支持 DeepSeek**：LLM 调用耦合了 DeepSeek API 格式
4. **无认证**：API 无鉴权，仅适合本地使用
5. **无流式输出**：生成是同步等待完成后渲染（非 SSE streaming）

---

## 技术栈速查

| 层 | 技术 | 版本 |
|----|------|------|
| 前端框架 | React | 18 |
| 构建工具 | Vite | 5 |
| 状态管理 | Zustand | 4 |
| CSS | Tailwind | 3 |
| 后端 | Express | 4 |
| LLM | DeepSeek API | chat/completions |
| 数据存储 | JSON 文件 | N/A |

---

## 项目状态

- ✅ 剧本解析（MD/自由文本/纯文本）
- ✅ AI 编辑润色（6 种编辑人格）
- ✅ 角色系统（MD 文件 + 人格参数 + 状态条）
- ✅ 导演系统（3 种导演风格）
- ✅ 一章一次 LLM 生成
- ✅ 打字机逐条动画
- ✅ 干预系统（节点干预 + 干预池）
- ✅ 表演确认弹窗
- ✅ 章节全联动切换
- ⬜ 流式生成（SSE streaming）
- ⬜ 多 LLM Provider 支持
- ⬜ 前端组件拆分
- ⬜ 用户认证
