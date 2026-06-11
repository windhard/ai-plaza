 cd ai-plaza/server && cp .env.example .env   # 编辑填入 DeepSeek API Key
  npm install && cd ../client && npm install   # 安装依赖
  cd ../server && node src/index.js            # 启动后端 :3001
  cd ../client && npx vite --port 5173         # 启动前端 :5173

  打开 http://localhost:5173 就能用了。



  1.打开章节设计，填入至少一章的内容或名称
  2.点击解析
  3.等待生成章节内容,情节节点，人物等节点。
  4.点击开始表演即可。

  PS.点击章节进度可以切换章节，在任意情节节点可以指定角色发言，注入念头，触发事件，然后重新生成即可看到全新版本。
