/**
 * SkillDrawer 组件
 *
 * 右侧技能管理抽屉：文件树（增删改）+ 文件内容编辑器 + 锁定/解锁。
 *
 * 设计决策：
 *  - 业务状态（skillOpen / skillTree / skillSelectedFile / skillFileContent / skillLocked
 *    / skillSaving / skillOriginalContent / skillFileLanguage）保留在父组件持有，
 *    因为这些是跨组件共享的（如 toolbar 按钮也要触发 skillOpen、handleSkillSave
 *    也要 setSkillSaving）。
 *  - 纯 UI 状态（skillTreeCollapsed / skillContentCollapsed / skillTreeHeight
 *    / skillEditorHeight / skillDrawerWidth）下沉到本组件内部，父组件无需感知。
 *  - 7 个 internal state 都是拖拽条/折叠开关/搜索过滤，与业务逻辑无关。
 *  - 不用 React.memo（父组件 state 更新频繁，memo 收益低）。
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Drawer, Button, Tree, Input } from 'antd';
import {
  LockOutlined,
  UnlockOutlined,
  CaretRightOutlined,
  DownOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  TableOutlined,
  EditOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';

export default function SkillDrawer({
  // ===== 业务数据 =====
  skillOpen,                    // boolean, 抽屉是否打开
  skillLocked,                  // boolean, 是否锁定（只读）
  skillTree,                    // any[], 目录树
  skillFileLanguage,            // string, 当前文件语言
  skillSelectedFile,            // string|null, 当前选中文件路径
  skillFileContent,             // string, 当前文件内容（Editor 受控值）
  skillOriginalContent,         // string, 文件原始内容（用于判断 dirty）
  skillSaving,                  // boolean, 保存中

  // ===== 业务回调 =====
  setSkillOpen,                 // (b) => void
  setSkillLocked,               // (b) => void
  setSkillFileContent,          // (s) => void, Editor onChange
  setAddTableModalOpen,         // (b) => void, "添加" 按钮
  loadSkillsList,               // () => Promise<void>, 首次打开时加载
  handleSkillFileSelect,        // (filePath: string) => Promise<void>
  handleSkillSave,              // () => Promise<void>
}) {
  // ===== 内部 UI 状态（纯 UI，无业务依赖）=====
  const [skillTreeCollapsed, setSkillTreeCollapsed] = useState(false);
  const [skillContentCollapsed, setSkillContentCollapsed] = useState(false);
  const [skillTreeHeight, setSkillTreeHeight] = useState(200);
  const [skillEditorHeight, setSkillEditorHeight] = useState(300);
  const [skillDrawerWidth, setSkillDrawerWidth] = useState(480);
  const [treeSearch, setTreeSearch] = useState('');

  // ===== 目录树关键字过滤 =====
  // 递归过滤：文件命中（title/key 包含关键字）则保留；文件夹自身命中则保留整个子树，
  // 否则仅当后代有命中时保留过滤后的 children
  const filterTree = useCallback((nodes, kw) => {
    const result = [];
    for (const node of nodes) {
      const selfMatch = node.title.toLowerCase().includes(kw) || node.key.toLowerCase().includes(kw);
      if (node.isFolder) {
        if (selfMatch) {
          result.push({ ...node, children: node.children || [] });
        } else {
          const children = filterTree(node.children || [], kw);
          if (children.length > 0) result.push({ ...node, children });
        }
      } else if (selfMatch) {
        result.push(node);
      }
    }
    return result;
  }, []);

  const filteredTree = useMemo(() => {
    const kw = treeSearch.trim().toLowerCase();
    if (!kw) return skillTree;
    return filterTree(skillTree, kw);
  }, [skillTree, treeSearch, filterTree]);

  // 展开状态始终受控：任何情况下手动折叠/展开都直接更新此 state
  const [expandedKeys, setExpandedKeys] = useState([]);

  // 搜索关键字变化时：有关键字 → 自动展开过滤结果中的所有文件夹（之后仍可手动折叠）；
  // 清空关键字 → 恢复默认全折叠
  useEffect(() => {
    if (!treeSearch.trim()) {
      setExpandedKeys([]);
      return;
    }
    const keys = [];
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.isFolder) {
          keys.push(n.key);
          walk(n.children || []);
        }
      }
    };
    walk(filteredTree);
    setExpandedKeys(keys);
  }, [treeSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== 拖拽条 handlers（捕获 startX/Y + startHeight/Width）=====
  const handleDrawerResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = skillDrawerWidth;
    let raf = 0;
    const handleMove = (moveEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(300, Math.min(800, startWidth + delta));
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setSkillDrawerWidth(newWidth);
      });
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      if (raf) cancelAnimationFrame(raf);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [skillDrawerWidth]);

  const handleTreeResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = skillTreeHeight;
    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      const newHeight = Math.max(80, Math.min(400, startHeight + delta));
      setSkillTreeHeight(newHeight);
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [skillTreeHeight]);

  const handleEditorResizerMouseDown = useCallback((e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = skillEditorHeight;
    let raf = 0;
    const handleMove = (moveEvent) => {
      const delta = moveEvent.clientY - startY;
      const newHeight = Math.max(100, Math.min(500, startHeight - delta));
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setSkillEditorHeight(newHeight);
      });
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      if (raf) cancelAnimationFrame(raf);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [skillEditorHeight]);

  return (
    <Drawer
      className="xtsql-drawer"
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Skill查看器</span>
          <Button
            type="text"
            size="small"
            icon={skillLocked ? <LockOutlined /> : <UnlockOutlined />}
            onClick={() => setSkillLocked(!skillLocked)}
            title={skillLocked ? '点击解锁编辑权限' : '点击锁定编辑权限'}
            style={{ color: skillLocked ? 'var(--xtsql-text-tertiary)' : 'var(--xtsql-success)' }}
          />
        </div>
      }
      placement="right"
      width={skillDrawerWidth}
      onClose={() => setSkillOpen(false)}
      open={skillOpen}
      onOpen={() => { if (skillTree.length === 0) loadSkillsList(); }}
      styles={{ body: { padding: '0 16px', position: 'relative' } }}
    >
      {/* 抽屉左侧拖拽条（拉宽拉窄） */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 8,
          cursor: 'ew-resize',
          zIndex: 10
        }}
        onMouseDown={handleDrawerResizerMouseDown}
      />

      <div className="skill-drawer-content" style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 6, overflow: 'hidden', paddingTop: 5 }}>
        {/* 目录结构区 */}
        <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: 4 }} onClick={() => setSkillTreeCollapsed(!skillTreeCollapsed)}>
          {skillTreeCollapsed ? <CaretRightOutlined style={{ marginRight: 4, fontSize: 10 }} /> : <DownOutlined style={{ marginRight: 4, fontSize: 10 }} />}
          <span style={{ fontSize: 12, fontWeight: 500 }}>目录结构</span>
        </div>

        {!skillTreeCollapsed && (
          <div style={{ marginBottom: 8, display: 'flex', gap: 8 }}>
            <Input
              size="small"
              placeholder="输入关键字搜索文件"
              prefix={<SearchOutlined style={{ color: 'var(--xtsql-text-tertiary)', fontSize: 11 }} />}
              allowClear
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
              style={{ fontSize: 11, flex: 1 }}
            />
            {!skillLocked && (
              <Button
                size="small"
                icon={<TableOutlined style={{ color: '#1890ff' }} />}
                style={{ fontSize: 11, color: '#1890ff' }}
                title="添加表格"
                onClick={() => setAddTableModalOpen(true)}
              >添加</Button>
            )}
          </div>
        )}

        {!skillTreeCollapsed && (
          <div
            style={{
              height: skillTreeHeight,
              overflow: 'auto',
              borderBottom: '1px solid var(--xtsql-border)',
              marginBottom: 8,
              padding: 8,
              background: 'var(--xtsql-hover)',
              borderRadius: 4,
              position: 'relative'
            }}
            className="skill-drawer-scroll"
          >
            {/* 目录树拖拽条 */}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 6,
                cursor: 'ns-resize',
                zIndex: 10
              }}
              onMouseDown={handleTreeResizerMouseDown}
            />
            <div style={{ height: '100%' }} className="skill-drawer-scroll">
              <div>
                {filteredTree.length > 0 ? (
                  <Tree
                    treeData={filteredTree}
                    showIcon={true}
                    expandedKeys={expandedKeys}
                    onExpand={(keys) => setExpandedKeys(keys)}
                    onSelect={(selectedKeys, { node }) => {
                      if (!node.isFolder) {
                        handleSkillFileSelect(node.key);
                      }
                    }}
                    style={{ fontSize: 12, padding: '4px 0' }}
                    icon={(node) => node.isFolder ? <FolderOpenOutlined style={{ color: '#faad14' }} /> : <FileTextOutlined style={{ color: '#1890ff' }} />}
                  />
                ) : (
                  <div style={{ color: '#999', fontSize: 12 }}>
                    {treeSearch.trim() ? '无匹配文件' : '暂无内容'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 文件内容区 */}
        <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: 4 }} onClick={() => setSkillContentCollapsed(!skillContentCollapsed)}>
          {skillContentCollapsed ? <CaretRightOutlined style={{ marginRight: 4, fontSize: 10 }} /> : <DownOutlined style={{ marginRight: 4, fontSize: 10 }} />}
          <span style={{ fontSize: 12, fontWeight: 500 }}>文件内容</span>
        </div>

        {!skillContentCollapsed && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', marginBottom: 10, position: 'relative' }}>
            {/* 编辑器拖拽条 */}
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
              onMouseDown={handleEditorResizerMouseDown}
            />
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{skillSelectedFile ? `文件: ${skillSelectedFile}` : '文件内容'}</span>
              {!skillLocked && skillSelectedFile && skillFileContent !== skillOriginalContent && (
                <Button
                  type="text"
                  size="small"
                  loading={skillSaving}
                  onClick={handleSkillSave}
                  style={{ padding: 2, height: 20, minWidth: 20 }}
                  icon={<EditOutlined style={{ fontSize: 12 }} />}
                />
              )}
            </div>
            <div style={{ flex: 1, border: '1px solid #444', borderRadius: 4, overflow: 'hidden', position: 'relative', background: '#1e1e1e' }}>
              <Editor
                height="100%"
                language={skillFileLanguage}
                value={skillSelectedFile ? skillFileContent : '请选择文件查看内容'}
                onChange={(value) => setSkillFileContent(value || '')}
                theme="vs-dark"
                options={{
                  readOnly: skillLocked,
                  minimap: { enabled: false },
                  fontSize: 11,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  wordWrap: 'on',
                  hover: { enabled: false }
                }}
              />
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
