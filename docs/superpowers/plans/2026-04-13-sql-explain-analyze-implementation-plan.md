# SQL EXPLAIN AI 分析功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SQL 预览区添加 AI 分析按钮，点击后通过模态框流式展示 AI 对 EXPLAIN 结果的分析和建议

**Architecture:** 
- 后端新增 `/api/query/explain-analyze` 路由，流式调用 LLM 分析
- 前端新增 "AI分析" 按钮，仅在有 EXPLAIN 结果时启用
- 使用 Modal 展示流式分析结果

**Tech Stack:** Express, React (Ant Design), SSE 流式输出

---

### Task 1: 后端新增 /api/query/explain-analyze 路由

**Files:**
- Modify: `backend/src/routes/query.js` (在文件末尾 `export default router;` 之前添加)

- [ ] **Step 1: 添加 explain-analyze 路由**

在 `query.js` 文件末尾 `export default router;` 之前添加以下代码：

```javascript
router.post('/explain-analyze', async (req, res) => {
  const { sql, explainResults } = req.body;
  
  if (!sql || !explainResults || !Array.isArray(explainResults)) {
    return res.json({ error: '请提供 SQL 语句和 EXPLAIN 结果', rowCount: 0 });
  }

  try {
    const config = getLlmConfig();
    if (!config || !config.apiKey) {
      return res.json({ error: 'LLM 未配置', rowCount: 0 });
    }

    // 构建分析提示词
    const prompt = `你是数据库性能优化专家。请分析以下 MySQL EXPLAIN 执行计划，找出潜在的性能问题并给出优化建议。

## SQL 语句
\`\`\`sql
${sql}
\`\`\`

## EXPLAIN 执行计划
\`\`\`json
${JSON.stringify(explainResults, null, 2)}
\`\`\`

请分析以下内容：
1. 是否使用了合适的索引（type 字段）
2. 是否有全表扫描（type=ALL）
3. 是否使用了 filesort 或 temporary
4. 可能的优化建议

请用中文回复，结构化输出分析结果。`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model || 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error('LLM API 请求失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') {
            res.write(`data: ${JSON.stringify({ type: 'done', analysis: fullContent })}\n\n`);
            break;
          }
          try {
            const data = JSON.parse(dataStr);
            const content = data.choices?.[0]?.delta?.content || '';
            if (content) {
              fullContent += content;
              res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }

    res.end();
  } catch (error) {
    logger.error('EXPLAIN analyze failed', { error: error.message });
    res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
    res.end();
  }
});
```

- [ ] **Step 2: 验证文件语法**

运行: `node --check backend/src/routes/query.js`
Expected: 无错误输出

---

### Task 2: 前端新增 explainAnalyze API

**Files:**
- Modify: `frontend/src/api/index.js`

- [ ] **Step 1: 添加 explainAnalyze 函数**

在 `api/index.js` 文件末尾 `export default api;` 之前添加：

```javascript
export function explainAnalyze(sql, explainResults) {
  return fetch('/api/query/explain-analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, explainResults })
  });
}
```

---

### Task 3: 前端添加 AI 分析按钮和 Modal

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: 添加状态变量**

在 `App` 组件内部状态定义区域（大约 231 行附近）添加：

```javascript
const [explainAnalyzeModalOpen, setExplainAnalyzeModalOpen] = useState(false);
const [explainAnalysisContent, setExplainAnalysisContent] = useState('');
const [explainAnalysisLoading, setExplainAnalysisLoading] = useState(false);
```

- [ ] **Step 2: 添加 handleExplainAnalyze 函数**

在 `handleExplain` 函数之后添加：

```javascript
const handleExplainAnalyze = async () => {
  const currentResults = activeTabKey !== 'chat' && tabs[activeTabKey]?.results 
    ? tabs[activeTabKey].results 
    : results;
  
  if (!sqlInput || !currentResults || currentResults.length === 0) return;
  
  setExplainAnalyzeModalOpen(true);
  setExplainAnalysisContent('');
  setExplainAnalysisLoading(true);
  
  try {
    const response = await fetch('http://localhost:5002/api/query/explain-analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: getSelectedSql(), explainResults: currentResults })
    });
    
    if (!response.ok) {
      throw new Error('请求失败');
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value);
      const lines = text.split('\n');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'chunk') {
              setExplainAnalysisContent(prev => prev + data.content);
            } else if (data.type === 'error') {
              message.error(data.content);
            } else if (data.type === 'done') {
              setExplainAnalysisLoading(false);
            }
          } catch (e) {
            console.warn('Parse SSE error:', e);
          }
        }
      }
    }
  } catch (error) {
    message.error(error.message);
    setExplainAnalysisLoading(false);
  }
};
```

- [ ] **Step 3: 修改按钮区域**

找到当前按钮区域（大约 1004-1012 行），在 "EXPLAIN" 按钮右侧添加：

```javascript
<Button 
  size="small" 
  icon={<SelectOutlined />}
  disabled={!sqlInput.trim() && !getSelectedSql()}
  onClick={() => handleExplain(getSelectedSql())}
>EXPLAIN</Button>
<Button 
  size="small" 
  style={{ marginLeft: 8 }}
  disabled={currentResults.length === 0}
  onClick={handleExplainAnalyze}
>AI分析</Button>
<Button type="primary" size="small" disabled={!sqlInput.trim() && !getSelectedSql()} onClick={() => handleExecute(getSelectedSql())}>查询</Button>
```

- [ ] **Step 4: 添加 Modal**

在文件末尾���在 `</ConfigProvider>` 之前）添加：

```javascript
<Modal
  title="AI 分析 EXPLAIN 结果"
  open={explainAnalyzeModalOpen}
  onCancel={() => setExplainAnalyzeModalOpen(false)}
  footer={null}
  width={700}
  style={{ top: 20 }}
>
  <div style={{ 
    maxHeight: '70vh', 
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 1.6,
    padding: '8px 12px',
    background: '#f5f5f5',
    borderRadius: 4
  }}>
    {explainAnalysisContent || (explainAnalysisLoading && '分析中...')}
    {explainAnalysisLoading && <Spin style={{ marginLeft: 8 }} />}
  </div>
</Modal>
```

- [ ] **Step 5: 验证前端编译**

运行: `cd frontend && npm run build`
Expected: 编译成功

---

### Task 4: 使用说明文档

**Files:**
- Modify: `docs/superpowers/specs/2026-04-12-sql-explain-design.md`

- [ ] **Step 1: 更新设计文档**

在 "变更记录" 部分添加：

```markdown
- 2026-04-13: 添加 AI 分析功能
  - 新增 /api/query/explain-analyze 路由（流式输出）
  - 前端添加 "AI分析" 按钮和 Modal
```

---

### Task 5: UI 调整 (2026-04-14)

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: 添加 isExplainResult 状态变量**

在状态定义区域添加（大约 235 行）：

```javascript
const [isExplainResult, setIsExplainResult] = useState(false);
```

- [ ] **Step 2: 修改 handleExplain 函数**

在设置结果后添加 `setIsExplainResult(true)`：

```javascript
setIsExplainResult(true);
setTabs(prev => ({ ... }));
```

- [ ] **Step 3: 修改 handleExecute 函数**

在设置结果后添加 `setIsExplainResult(false)`：

```javascript
setIsExplainResult(false);
setTabs(prev => ({ ... }));
```

- [ ] **Step 4: 修改按钮显示位置**

移除 SQL 预览区域的 AI 分析按钮，添加至查询结果区域：

```javascript
// 移除原 AI 分析按钮（原第1079-1084行）

// 在查询结果区域 (约 1122 行) 添加：
<div style={{ marginBottom: 8, marginTop: 6, flexShrink: 0, display: 'flex', gap: 8 }}>
  <Button size="small" onClick={() => exportToExcel(currentResults, columns)}>导出Excel</Button>
  {isExplainResult && (
    <Button 
      size="small" 
      icon={<RobotOutlined />}
      onClick={handleExplainAnalyze}
    >AI分析</Button>
  )}
</div>
```

- [ ] **Step 5: 添加 RobotOutlined 图标导入**

在 `@ant-design/icons` 导入中添加 `RobotOutlined`：

```javascript
import { ..., RobotOutlined } from '@ant-design/icons';
```

- [ ] **Step 6: 验证**

运行: `cd frontend && npm run build`
Expected: 编译成功

---

## 验证步骤

完成后手动验证：
1. 在 SQL 预览区输入 SQL 语句
2. 点击 "EXPLAIN" 按钮，确认有结果输出
3. 点击 "AI分析" 按钮，确认模态框打开
4. 等待流式输出完成，确认分析内容正确显示

**Plan complete and saved to `docs/superpowers/plans/2026-04-13-sql-explain-analyze-implementation-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

**Which approach?**