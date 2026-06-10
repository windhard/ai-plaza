# AI 广场 v3 — 迁移指南

> 如何把整个项目迁移到另一台机器上，并让另一个 AI 快速上手

---

## 方式 A：整体目录拷贝（推荐）

### 在新机器上

```bash
# 1. 把整个 ai-plaza/ 目录拷贝到新机器
#    可以用 U盘/网盘/scp/rsync 任意方式

# 2. 安装依赖
cd ai-plaza/server && npm install
cd ../client && npm install

# 3. 配置 API Key
cd ../server
cp .env.example .env
# 编辑 .env，填入你的 DEEPSEEK_API_KEY

# 4. 启动
node src/index.js        # 后端 → http://localhost:3001
# 新终端
cd ../client && npx vite --port 5173  # 前端 → http://localhost:5173
```

### 什么需要保留

| 目录/文件 | 必须 | 说明 |
|-----------|------|------|
| `server/` | ✅ | 后端代码 + package.json |
| `client/` | ✅ | 前端代码 + package.json |
| `data/` | ✅ | **最重要**——所有运行时数据（章节/角色/消息） |
| `server/.env` | ✅ | API Key（不会被 .gitignore 忽略的模板需要手动填） |
| `server/node_modules/` | ❌ | npm install 重新生成 |
| `client/node_modules/` | ❌ | npm install 重新生成 |

### 最小迁移包

如果只想迁移核心，最少需要：
```
ai-plaza/
├── server/
│   ├── package.json
│   ├── .env
│   └── src/
├── client/
│   ├── package.json
│   ├── index.html
│   ├── vite.config.ts / tailwind.config.js / postcss.config.js
│   └── src/
└── data/              ← 最重要！
    ├── plaza.json
    ├── characters/
    ├── directors/
    └── editors/
```

---

## 方式 B：Git 版本控制

```bash
# 在原机器
cd ai-plaza
git init
echo "node_modules/" > .gitignore
echo "server/.env" >> .gitignore
git add -A
git commit -m "ai-plaza v3 complete"

# 推到远程
git remote add origin <your-repo-url>
git push -u origin main

# 在新机器
git clone <your-repo-url>
cd ai-plaza
cp server/.env.example server/.env  # 编辑填入 API Key
cd server && npm install
cd ../client && npm install

# 启动同上
```

---

## 让另一个 AI 快速上手的步骤

### 第一步：把这 4 个文件丢给它

按顺序让新 AI 阅读：
1. **README.md** — 了解这是什么、怎么启动
2. **DESIGN.md** — 理解架构和数据流
3. **TEST.md** — 知道怎么验证功能正常
4. **PROJECT_SNAPSHOT.md** — 了解历史上下文

### 第二步：给它这个 prompt

```
请阅读 ai-plaza 项目的 README.md, DESIGN.md, TEST.md。
然后：
1. 启动后端和前端
2. 运行测试用例验证一切正常
3. 告诉我项目当前状态
```

### 第三步：验证 AI 是否理解

问它：
- "当前有几个章节？几个角色？"
- "如果要新增一个导演风格，应该怎么做？"
- "LLM 生成的 prompt 在哪里可以修改？"

如果都能答对，说明它已经理解了项目。

---

## 迁移后验证清单

```bash
# 1. 后端能启动
cd server && node src/index.js
# 预期输出：🏛️  AI Plaza server on http://localhost:3001

# 2. API 能响应
curl http://localhost:3001/api/plaza
# 预期：{"success":true,"data":{...}}

# 3. 数据不丢失
curl http://localhost:3001/api/chapters | python -m json.tool | head -20
# 预期：能看到之前的章节

# 4. 前端能打开
# 浏览器访问 http://localhost:5173
# 预期：三栏布局，左栏有角色，右栏有章节进度

# 5. 生成功能正常
# 在 UI 中点击「▶ 开始表演」
# 预期：打字机动画展示对话

# 6. 测试用例通过
cd server && node src/test-runner.js
# 预期：所有 ✅，无报错
```

---

## 常见迁移问题

### Q: `npm install` 失败
A: 确认 Node.js ≥ 18。Windows 上可能需要安装 build tools：
```bash
npm install -g windows-build-tools  # 仅 Windows 7/8
```

### Q: 后端启动报 `DEEPSEEK_API_KEY` 相关
A: 检查 `server/.env` 是否存在且内容正确：
```
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
DEEPSEEK_MODEL=deepseek-chat
```

### Q: 前端访问后端 CORS 报错
A: 后端已配置 `cors()` 中间件，默认允许所有来源。如果改了端口，确认 vite 代理配置正确。

### Q: 生成功能超时
A: 默认超时 180 秒。如果模型响应慢（尤其 deepseek-v4-pro 推理模型），可以在 `server/src/llm/index.js` 增大 `AbortSignal.timeout(180000)` 的值。

### Q: 数据想从零开始
A: 
```bash
# 方式1：保留种子数据
curl -X POST http://localhost:3001/api/reset

# 方式2：完全清空
curl -X POST http://localhost:3001/api/clear
```
