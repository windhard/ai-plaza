# AI 广场 v3 — 项目快照

> 保存时间：2026-06-05
> 状态：功能完整，可正常启动

---

## 快速启动

```bash
cd ai-plaza

# 后端（端口 3001）
cd server && node src/index.js

# 前端（端口 5173）
cd client && npx vite --port 5173

# 浏览器打开 http://localhost:5173
```

---

## 数据层（v3 重构后）

| 存储位置 | 内容 | 谁改 |
|---------|------|------|
| `data/world.md` | 世界观设定 | 人 |
| `data/outline.md` | 故事大纲 | 人 |
| `data/chapters/*.md` | 章节内容（YAML frontmatter + 节点） | 人 + AI解析 |
| `data/characters/*.md` | 角色（YAML frontmatter 含人格参数） | 人 |
| `data/directors/*.md` | 导演风格 | 人 |
| `data/editors/*.md` | 编辑人格 | 人 |
| `data/plaza.json` | 运行时状态（当前章、角色状态、消息） | 机器 |

## 当前数据

- 无章节（已清空，可通过种子数据重建：POST /api/seed）
- 11 个角色（MD 文件完整）
- 3 个导演风格（默认/暗黑/情欲）
- 5 个编辑人格（asi/laoqiang/shenyan/suwan/zhoumo）

## 关键配置

| 项目 | 说明 |
|------|------|
| API Key | server/.env → DEEPSEEK_API_KEY |
| 模型 | deepseek-v4-flash（thinking: disabled） |
| 后端端口 | 3001 |
| 前端端口 | 5173 |
