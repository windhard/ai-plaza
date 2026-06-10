// ═══ AI 广场服务器入口 ═══
import express from 'express';
import cors from 'cors';
import apiRoutes from './routes/index.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/api', apiRoutes);

app.listen(PORT, () => {
  console.log(`🏛️  AI Plaza server on http://localhost:${PORT}`);
  console.log(`   POST /api/parse-script  — 解析剧本`);
  console.log(`   POST /api/generate      — 批量生成表演`);
});
