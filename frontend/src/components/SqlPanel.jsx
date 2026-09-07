/**
 * SqlPanel 组件
 *
 * SQL 查询面板：Monaco 编辑器 + EXPLAIN/查询 按钮 + 结果表 + 可选 EXPLAIN 表。
 *
 * 设计决策：
 *  - sqlInput / sqlKey / resultKey / currentResults / explainResults / columns / explainColumns
 *    全部由父组件持有（因为跨 tab 切换时会复用，handleExecute / handleExplain 也在父组件）。
 *  - sqlEditorInst 仍在父组件持有，因为 getSelectedSql 是父组件 handleExplainAnalyze
 *    也要用的；本组件只通过 setSqlEditorInst prop 把实例回传。
 *  - sqlPreviewHeight / resultTableHeight / pageSize / resizerRef
 *    是纯 UI 状态，下沉到本组件内部。父组件无需知道。
 *  - 父组件定义 getSelectedSql（闭包依赖 sqlEditorInst + sqlInput），传入本组件。
 *  - AppIcon / SelectOutlined / ResizableTitle 直接 import 而非通过 props 传入，
 *    避免 props 列表臃肿。
 *  - 不做 React.memo（state setter 已稳定，但回调在父组件是新创建的，memo 收益低）。
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Table, Collapse, Tooltip } from 'antd';
import { SelectOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import AppIcon from './AppIcon.jsx';
import ResizableTitle from './ResizableTitle';

export default function SqlPanel({
  // ===== 业务数据 =====
  sqlInput,                 // string, Monaco 受控值
  sqlKey,                   // string[], Collapse activeKey
  setSqlKey,                // (k: string[]) => void
  resultKey,                // string[]
  setResultKey,             // (k: string[]) => void
  currentResults,           // any[]
  columns,                  // antd ColumnType[]
  currentRowCount,          // number
  currentQueryTime,         // number
  explainResults,           // any[]
  explainColumns,           // antd ColumnType[]

  // ===== 业务回调 =====
  setSqlEditorInst,         // (editor) => void, Editor onMount 回调
  getSelectedSql,           // () => string, 选区 SQL 或全文
  onSqlChange,              // (value) => void, Editor onChange
  onExecute,                // (sql) => void, "查询" 按钮（SQL 直接执行，非 LLM 流）
  onExplain,                // (sql) => void, "EXPLAIN" 按钮（SQL 直接执行，非 LLM 流）
  onExplainAnalyze,         // () => void, "AI 分析" 按钮（★ 这是 LLM 流，需 globalStreaming 守卫）
  onExportExcel,            // () => void, "导出 Excel" 按钮
  // ★ 2026-08-24 多会话并行：是否全局有 LLM 流在跑
  //   只用来禁用"AI分析"按钮（其他按钮都是 SQL 直查，不算"流式输出"）
  globalStreaming,
}) {
  // ===== 内部 UI 状态 =====
  const [sqlPreviewHeight, setSqlPreviewHeight] = useState(200);
  const [resultTableHeight, setResultTableHeight] = useState(800);
  const [pageSize, setPageSize] = useState(20);
  const resizerRef = useRef(null);

  // 拖拽条 mousedown 闭包
  const handlePreviewResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = sqlPreviewHeight;
    let raf = 0;
    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      const newHeight = Math.max(100, Math.min(500, startHeight + delta));
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setSqlPreviewHeight(newHeight);
      });
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      if (raf) cancelAnimationFrame(raf);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [sqlPreviewHeight]);

  const handleResultResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = resultTableHeight;
    let raf = 0;
    const handleMove = (moveEvent) => {
      const delta = startY - moveEvent.clientY;
      const newHeight = Math.max(100, Math.min(600, startHeight + delta));
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setResultTableHeight(newHeight);
      });
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      if (raf) cancelAnimationFrame(raf);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [resultTableHeight]);

  const handleEditorMount = (editor, monaco) => {
    setSqlEditorInst(editor);
    // Monaco hover 抑制已搬到 utils/monacoEnv.js 全局处理(3 个 Monaco 实例共用)
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Collapse
        activeKey={sqlKey}
        onChange={(key) => {
          const k = Array.isArray(key) ? key : [key];
          setSqlKey(k);
          setResultKey(k);
        }}
        style={{ flex: 1, overflow: 'auto' }}
        className="custom-collapse"
        items={[
          {
            key: 'sql',
            label: <span style={{ fontWeight: 500, fontSize: 12 }}>SQL预览</span>,
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} ref={resizerRef}>
                <div style={{ border: '1px solid #d9d9d9', borderRadius: 4, position: 'relative' }}>
                  <Editor
                    onMount={handleEditorMount}
                    height={sqlPreviewHeight}
                    defaultLanguage="sql"
                    value={sqlInput}
                    onChange={onSqlChange}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 11,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      wordWrap: 'on',
                      folding: false,
                      glyphMargin: false,
                      renderLineHighlight: 'none',
                      hover: { enabled: false },
                      quickSuggestions: false,
                      parameterHints: { enabled: false },
                      suggestOnTriggerCharacters: false,
                      acceptSuggestionOnEnter: 'off',
                      tabCompletion: 'off',
                      wordBasedSuggestions: 'off'
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      height: 6,
                      cursor: 'ns-resize',
                      background: 'transparent',
                      zIndex: 10
                    }}
                    onMouseDown={handlePreviewResizerMouseDown}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Button
                    size="small"
                    icon={<SelectOutlined />}
                    disabled={!sqlInput.trim() && !getSelectedSql()}
                    onClick={() => onExplain(getSelectedSql())}
                  >EXPLAIN</Button>

                  <Button type="primary" size="small" disabled={!sqlInput.trim() && !getSelectedSql()} onClick={() => onExecute(getSelectedSql())}>查询</Button>
                </div>
              </div>
            )
          },
          {
            key: 'result',
            label: <span style={{ fontWeight: 500, fontSize: 12 }}>查询结果 ({currentRowCount} 条{currentQueryTime ? `, ${currentQueryTime}ms` : ''})</span>,
            children: currentResults.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 6,
                    cursor: 'ns-resize',
                    zIndex: 10
                  }}
                  onMouseDown={handleResultResizerMouseDown}
                />
                <div style={{ marginBottom: 8, marginTop: 6, flexShrink: 0, display: 'flex', gap: 8 }}>
                  <Button size="small" onClick={onExportExcel}>导出Excel</Button>
                </div>
                <div style={{ height: resultTableHeight, overflow: 'visible' }}>
                  <Table
                    dataSource={currentResults}
                    columns={columns}
                    rowKey={(record, index) => record.id ?? `row-${index}`}
                    components={{ header: { cell: ResizableTitle } }}
                    pagination={{
                      pageSize,
                      showSizeChanger: true,
                      pageSizeOptions: ['10', '20', '50', '100'],
                      onShowSizeChange: (_, size) => setPageSize(size)
                    }}
                    scroll={{ x: 'max-content' }}
                    size="small"
                    className="sql-result-table"
                    style={{ fontSize: 10 }}
                    rootClassName="sticky-table-header"
                  />
                </div>
              </div>
            ) : (
              <div style={{ color: '#999' }}>暂无结果</div>
            )
          },
          ...(explainResults.length > 0 ? [{
            key: 'explain',
            label: <span style={{ fontWeight: 500, fontSize: 12 }}>执行计划</span>,
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <Tooltip
                    // ★ 2026-08-24 多会话并行：另一会话 LLM 流在跑时禁用 AI 分析
                    //   AI 分析 = handleExplainAnalyze = LLM 流，会和 handleSend 竞争 token
                    //   → 与 handleSend 同样走"一页面同一时间只有一个流式输出"约束
                    title={globalStreaming ? '另一会话正在生成中，请等待或先停止' : undefined}
                  >
                    <Button
                      size="small"
                      icon={<AppIcon size={18} />}
                      disabled={globalStreaming}
                      onClick={onExplainAnalyze}
                    >AI分析</Button>
                  </Tooltip>
                </div>
                <Table
                  dataSource={explainResults}
                  columns={explainColumns}
                  rowKey={(record, index) => record.id ?? `row-${index}`}
                  pagination={{
                    pageSize,
                    showSizeChanger: true,
                    pageSizeOptions: ['10', '20', '50', '100'],
                    onShowSizeChange: (_, size) => setPageSize(size)
                  }}
                  scroll={{ x: 'max-content' }}
                  size="small"
                  className="sql-result-table"
                  style={{ fontSize: 10 }}
                  rootClassName="sticky-table-header"
                />
              </div>
            )
          }] : [])
        ]}
      />
    </div>
  );
}
