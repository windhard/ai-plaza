// ═══ TC-INPUT 测试 ═══
// 验证：剧本输入 → 结构化（章节名称 + 人物人格 + 情节节点）
import { parseScript } from './parser.js';

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg}`); }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══ TC-INPUT-001：结构化 MD 正确解析 ═══
async function tc001() {
  console.log('\n═══ TC-INPUT-001：结构化 MD 解析 ═══');
  const input = `## 第一章：完美秘书的日常
**目的**：展示极端自律与压抑
**场景**：清晨办公室，阳光落地窗
**情节**：
- 早晨仪式感日常
- 帮助同事却保持距离
- 晚上回家后自我反省
**人物A**：陈都灵，主角，极端自律清冷可靠
**人物B**：李秘书，同事，随和热情`;

  const { chapters, characters } = await parseScript(input);

  assert(chapters.length >= 1, '生成至少 1 章');
  const ch1 = chapters[0];
  assert(ch1.title === '完美秘书的日常', `标题正确: "${ch1.title}"`);
  assert(ch1.purpose.includes('自律') || ch1.purpose.includes('压抑'), `目的含关键词: "${ch1.purpose}"`);
  assert(ch1.scene.includes('办公室') || ch1.scene.includes('阳光'), `场景含关键词: "${ch1.scene}"`);
  assert(ch1.beats.length === 3, `3 个节点 (实际: ${ch1.beats.length})`);
  assert(characters.length >= 2, `至少 2 个角色 (实际: ${characters.length})`);

  const duling = characters.find(c => c.name === '陈都灵');
  assert(duling, '识别陈都灵');
  assert(duling?.personalityHint?.includes('自律') || duling?.role === '主角', `陈都灵信息: ${duling?.role} / ${duling?.personalityHint}`);

  const li = characters.find(c => c.name === '李秘书');
  assert(li, '识别李秘书');
  assert(li?.personalityHint?.includes('随和') || li?.personalityHint?.includes('热情'), `李秘书信息: ${li?.personalityHint}`);

  console.log(`  章: ${chapters.map(c => c.title).join(', ')}`);
  console.log(`  人物: ${characters.map(c => c.name).join(', ')}`);
}

// ═══ TC-INPUT-002：模糊 MD（最小结构） ═══
async function tc002() {
  console.log('\n═══ TC-INPUT-002：模糊 MD 解析 ═══');
  const input = `## 第一章：
**目的**：测试
**场景**：办公室
**情节**：
- 上班
- 工作
- 下班`;

  const { chapters } = await parseScript(input);

  assert(chapters.length >= 1, '生成至少 1 章');
  const ch1 = chapters[0];
  assert(ch1.beats.length >= 3, `至少 3 个节点 (实际: ${ch1.beats.length})`);
  // 模糊词被 LLM 扩写后应更长
  assert(ch1.beats.every(b => b.description.length > 0), '所有节点描述非空');
  // 不应报错
  assert(true, '不因内容过少报错');
  console.log(`  节点: ${ch1.beats.map(b => b.description).join(' | ')}`);
}

// ═══ TC-INPUT-003：纯故事文本 ═══
async function tc003() {
  console.log('\n═══ TC-INPUT-003：纯故事文本解析 ═══');
  const input = `陈都灵七点就到了公司。她擦了三遍键盘才开机。李秘书九点才来，手里拎着咖啡。她把昨晚他交错的报表悄悄改好了，放在他桌上。晚上回家后她在笔记本上写：今天多看了他一眼，半秒，多余。`;

  const { chapters, characters } = await parseScript(input);

  assert(chapters.length >= 1, '生成至少 1 章');
  assert(characters.find(c => c.name === '陈都灵'), '识别陈都灵');
  const ch1 = chapters[0];
  assert(ch1.beats.length >= 2, `至少 2 个节点 (实际: ${ch1.beats.length})`);
  assert(ch1.scene.length > 3, `场景非空: "${ch1.scene}"`);
  console.log(`  章: "${ch1.title}", 节数: ${ch1.beats.length}`);
  console.log(`  人物: ${characters.map(c => c.name).join(', ')}`);
}

// ═══ TC-INPUT-004：纯关键词 ═══
async function tc004() {
  console.log('\n═══ TC-INPUT-004：关键词解析 ═══');
  const input = `办公室 秘书 要挟 堕落`;

  const { chapters } = await parseScript(input);

  assert(chapters.length >= 1, '生成至少 1 章');
  const ch1 = chapters[0];
  assert(ch1.beats.length >= 1, `至少 1 个节点 (实际: ${ch1.beats.length})`);
  assert(ch1.purpose.length > 0, '目的字段非空');
  console.log(`  章: "${ch1.title}", 节数: ${ch1.beats.length}, 目的: "${ch1.purpose}"`);
}

// ═══ TC-INPUT-005：一次输入 5 章 ═══
async function tc005() {
  console.log('\n═══ TC-INPUT-005：5 章输入 ═══');
  const input = `## 第一章：完美秘书
**目的**：展示自律
**场景**：办公室
**情节**：
- 早起日常
- 帮助同事
**人物A**：陈都灵，主角

## 第二章：暴雨夜
**目的**：描写死亡
**场景**：暴雨夜办公室
**情节**：
- 加班深夜
- 触电意外
**人物A**：保安老王，门卫

## 第三章：地狱审判
**目的**：灵魂审判
**场景**：地狱审判厅
**情节**：
- 灵魂坠落
- 恶魔嘲讽
**人物A**：审判恶魔

## 第四章：熔铸池
**目的**：灵魂重塑
**场景**：熔铸池
**情节**：
- 投入池中
- 撕裂重塑

## 第五章：跳蛋植入
**目的**：封印植入
**场景**：祭坛
**情节**：
- 触手推送
- 封印完成`;

  const { chapters, characters } = await parseScript(input);

  assert(chapters.length === 5, `5 章 (实际: ${chapters.length})`);
  assert(chapters.every(c => c.beats.length >= 1), '每章至少 1 节');
  assert(characters.length >= 3, `至少 3 个角色 (实际: ${characters.length})`);

  // 角色去重检查
  const names = characters.map(c => c.name);
  assert(new Set(names).size === names.length, `角色无重复: ${names.join(', ')}`);

  console.log(`  章: ${chapters.map(c => c.title).join(' → ')}`);
  console.log(`  人物: ${characters.map(c => c.name).join(', ')}`);
}

// ═══ TC-INPUT-006：单字输入 ═══
async function tc006() {
  console.log('\n═══ TC-INPUT-006：单字输入 ═══');
  const input = `怒`;

  const { chapters } = await parseScript(input);

  // 不应崩溃
  assert(chapters.length >= 1, '不崩溃，返回至少 1 章');
  console.log(`  章数: ${chapters.length}`);
}

// ═══ TC-INPUT-007：空输入 ═══
async function tc007() {
  console.log('\n═══ TC-INPUT-007：空输入 ═══');
  const input = '';

  try {
    const { chapters } = await parseScript(input);
    assert(chapters.length === 0 || chapters.every(c => c.beats.length === 0), '空输入不生成内容');
  } catch {
    assert(true, '空输入报错（预期行为）');
  }
}

// ═══ TC-INPUT-008：LLM 退化保护 ═══
async function tc008() {
  console.log('\n═══ TC-INPUT-008：LLM 退化保护 ═══');
  const input = `## 第一章：测试退化
**目的**：测试
**场景**：办公室
**情节**：
- 节点1：早起
- 节点2：工作
- 节点3：下班
- 节点4：回家
- 节点5：睡觉
**人物A**：张三，员工
**人物B**：李四，经理`;

  // 先用 regex 获取基准
  const { chapters: regexOnly } = await parseScript(input, { useLLM: false });
  const regexBeats = regexOnly.reduce((s, c) => s + c.beats.length, 0);

  // 再用 LLM 增强
  const { chapters } = await parseScript(input, { useLLM: true });
  const totalBeats = chapters.reduce((s, c) => s + c.beats.length, 0);

  assert(totalBeats >= regexBeats, `LLM 增强后节数(${totalBeats}) >= regex(${regexBeats})，不发生退化`);
  console.log(`  Regex: ${regexBeats} 节, LLM增强后: ${totalBeats} 节`);
}

// ═══ 主函数 ═══
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  AI 广场 v3 · TC-INPUT 测试');
  console.log(`  模型: ${process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro'}`);
  console.log('═══════════════════════════════════════');

  const tests = [tc001, tc002, tc003, tc004, tc005, tc006, tc007, tc008];
  for (const test of tests) {
    try {
      await test();
      // 测试之间暂停一下，避免 API 限流
      await sleep(500);
    } catch (e) {
      failed++;
      console.log(`  ❌ 未捕获错误: ${e.message}`);
    }
  }

  console.log(`\n═══════════════════════════════════════`);
  console.log(`  通过: ${passed} | 失败: ${failed}`);
  console.log(`═══════════════════════════════════════`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
