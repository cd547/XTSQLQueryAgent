# EXPLAIN 面板分离实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 EXPLAIN 结果从查询结果中分离，在查询结果Tab下方新增可折叠的"执行计划"面板

**Architecture:** 在 App.jsx 中新增两个状态(explainResults, explainPanelOpen)，在Tab区域外添加折叠面板

**Tech Stack:** React, Ant Design Collapse

---

### Task 1: 添加新状态

**Files:**
- Modify: `frontend/src/App.jsx:236-237`

- [x] **Step 1: 添加 states**

在 `isExplainResult` 状态后添加两个新状态：
```jsx
const [explainResults, setExplainResults] = useState([]);
const [explainPanelOpen, setExplainPanelOpen] = useState(false);
```

---

### Task 2: 修改 handleExplain 函数

**Files:**
- Modify: `frontend/src/App.jsx:640-661`

- [x] **Step 1: 修改 handleExplain**

将EXPLAIN结果存储到explainResults，并展开面板：
```jsx
const handleExplain = async (sql) => {
  if (!sql) return;
  setLoading(true);
  setSqlKey(['sql', 'result']);
  setResultKey(['sql', 'result']);
  const startTime = Date.now();
  try {
    const res = await explainQuery({ sql });
    const elapsed = Date.now() - startTime;
    if (res.error) {
      message.error(res.error);
    } else {
      const newResults = res.results || [];
      setColumnWidths({});
      setExplainResults(newResults);  // 存储到 explainResults
      setExplainPanelOpen(true);   // 展开面板
      setIsExplainResult(true);
      message.success(`EXPLAIN 完成，${res.rowCount} 行，耗时 ${elapsed}ms`);
    }
  } finally {
    setLoading(false);
  }
};
```

---

### Task 3: 添加执行计划折叠面板

**Files:**
- Modify: `frontend/src/App.jsx:1154-1186`

- [x] **Step 1: 在Tab区域外添加折叠面板**

在Tab组件结束后、div闭合前添加：
```jsx
{(isExplainResult || explainResults.length > 0) && (
  <Collapse
    activeKey={explainPanelOpen ? ['explain'] : []}
    onChange={(key) => setExplainPanelOpen(key && key.includes('explain'))}
    style={{ marginTop: 8 }}
    items={[
      {
        key: 'explain',
        label: <span style={{ fontWeight: 500, fontSize: 12 }}>执行计划</span>,
        children: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button size="small" icon={<RobotOutlined />} onClick={handleExplainAnalyze}>AI分析</Button>
            </div>
            <Table
              dataSource={explainResults}
              columns={explainColumns}
              pagination={{ pageSize: pageSize, showSizeChanger: true }}
              scroll={{ x: 'max-content' }}
              size="small"
              className="sql-result-table"
            />
          </div>
        )
      }
    ]}
  />
)}
```

---

### Task 4: 添加 explainColumns

**Files:**
- Modify: `frontend/src/App.jsx:880-892`

- [x] **Step 1: 添加 explainColumns**

为EXPLAIN结果生成独立的列定义：
```jsx
const explainColumns = explainResults.length > 0
? Object.keys(explainResults[0]).map((key, idx) => ({ 
    title: (props) => (
      <ResizableTitle width={columnWidths[key] || 150} onResize={handleResize(key)}>
        <span style={{ fontSize: 12 }}>{key}</span>
      </ResizableTitle>
    ),
    dataIndex: key, 
    key: `col-${idx}`,
    ellipsis: true,
    width: columnWidths[key] || 150
  }))
: [];
```

---

### Task 5: 修改 handleExplainAnalyze

**Files:**
- Modify: `frontend/src/App.jsx:664-683`

- [x] **Step 1: 使用 explainResults**

将原来使用 currentResults 改为使用 explainResults：
```jsx
const handleExplainAnalyze = async () => {
  if (!sqlInput || explainResults.length === 0) return;
  // ... 使用 explainResults 而不是 currentResults
};
```

---

### Task 6: 测试验证

**Files:**
- 无

- [x] **Step 1: 构建验证**

运行 `npm run build` 确认无语法错误

- [x] **Step 2: 功能测试**

1. 执行普通查询 → 查询结果显示
2. 执行EXPLAIN → 执行计划面板展开，显示EXPLAIN结果

---

## 实现完成

所有任务已完成，EXPLAIN功能正常工作：
- 查询结果显示在Tab内
- 执行计划在Tab下方单独的面板中
- 默认折叠，点击EXPLAIN后展开
- AI分析按钮在执行计划面板内