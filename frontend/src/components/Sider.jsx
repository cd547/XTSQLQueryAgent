/**
 * Sider 组件
 *
 * 左侧会话侧边栏：新建按钮 + 会话列表 + Skill/配置入口 + 用户卡片 + 登出。
 *
 * 设计决策：
 *  - 数据层走 useSessionList hook（sessions / sessionsTotal / hasMoreSessions / loadingMoreSessions
 *    + 分页加载 + 滚动监听），本组件只消费这些 prop。
 *  - 业务回调（onNewSession / onSessionClick / onDeleteSession / onStartRename /
 *    onRenameSession / onSummarizeSession）由父组件提供，本组件不持有业务逻辑。
 *  - 跨切操作（打开配置抽屉 / 打开 Skill 抽屉 / 改密 / 登出）通过 onConfigClick /
 *    onSkillClick / onChangePasswordClick / onLogout 透传，避免 Sider 知道这些状态。
 *  - siderListRef 本地持有（DOM 引用无需外漏）。
 *  - 重命名编辑态（editingSessionId / editingSessionName）是纯 UI 状态，由父组件持有
 *    后通过 prop 传入；Sider 只负责显示 Input 还是 span。
 *  - 当前会话高亮用 currentSessionId prop 控制。
 *  - antd Layout 的 Sider 子组件在模块顶层解构（与 App.jsx 一致）。
 */
import React, { useRef } from 'react';
import { Layout, Button, Dropdown, Input, Tooltip, Modal } from 'antd';
import {
  PlusOutlined,
  FileTextOutlined,
  EditOutlined,
  DeleteOutlined,
  MoreOutlined,
  SettingOutlined,
  FolderOutlined,
  LockOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { formatSqliteUtcLocal } from '../utils/formatTime';

const { Sider: AntSider } = Layout;

export default function Sider({
  // ===== 数据 =====
  sessions,                       // any[]
  sessionsTotal,                  // number
  hasMoreSessions,                // boolean
  loadingMoreSessions,            // boolean
  currentSessionId,               // string | null
  editingSessionId,               // string | null
  editingSessionName,             // string
  user,                           // { display_name, username, role, ... } | null
  collapsed,                      // boolean, Sider 折叠状态

  // ===== 重命名 UI 状态 setter =====
  setEditingSessionName,          // (s) => void

  // ===== 业务回调 =====
  onNewSession,                   // () => void
  onSessionClick,                 // (session) => void
  onDeleteSession,                // (sessionId) => void
  onStartRename,                  // (session) => void
  onRenameSession,                // (sessionId) => void
  onSummarizeSession,             // (sessionId) => void
  onSiderScroll,                  // (e) => void

  // ===== 跨切操作回调（替换原 inline setState）=====
  onConfigClick,                  // () => void
  onSkillClick,                   // () => void
  onChangePasswordClick,          // () => void
  onLogout,                       // () => void
}) {
  const siderListRef = useRef(null);

  return (
    <AntSider
      width={260}
      className="xtsql-sider"
      style={{ background: 'var(--xtsql-bg-sider)', borderRight: '1px solid var(--xtsql-border)' }}
      collapsed={collapsed}
      collapsible
      collapsedWidth={0}
      trigger={null}
    >
      <div className="xtsql-sider-inner">
        {/* 头部：新建对话按钮 */}
        <div className="xtsql-sider-header">
          <Button className="xtsql-new-chat-btn" icon={<PlusOutlined />} onClick={onNewSession}>
            新建对话
          </Button>
        </div>

        {/* 会话列表（带滚动触底加载） */}
        <div className="xtsql-sider-list" ref={siderListRef} onScroll={onSiderScroll}>
          <div className="xtsql-sider-section">
            <span>最近对话</span>
            <span style={{ color: 'var(--xtsql-text-tertiary)' }}>{sessionsTotal || sessions.length}</span>
          </div>
          {sessions.length === 0 ? (
            <div style={{ padding: '24px 8px', textAlign: 'center', fontSize: 12, color: 'var(--xtsql-text-tertiary)' }}>
              暂无对话
            </div>
          ) : (
            <>
              {sessions.map(item => (
                <Tooltip
                  key={item.id}
                  title={item.summary || ''}
                  placement="right"
                  styles={{ root: { maxWidth: 320 } }}
                >
                  <div
                    className={`xtsql-session-item ${currentSessionId === item.id ? 'active' : ''}`}
                    onClick={() => onSessionClick(item)}
                  >
                  <div className="xtsql-session-meta">
                    {editingSessionId === item.id ? (
                      <Input
                        size="small"
                        value={editingSessionName}
                        onChange={(e) => setEditingSessionName(e.target.value)}
                        onPressEnter={() => onRenameSession(item.id)}
                        onBlur={() => onRenameSession(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <>
                        <div className="xtsql-session-name">{item.name}</div>
                        <div className="xtsql-session-desc">
                          {formatSqliteUtcLocal(item.created_at, { hour12: false })}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="xtsql-session-actions" onClick={(e) => e.stopPropagation()}>
                    <Dropdown
                      menu={{
                        items: [
                          { key: 'summarize', label: '总结聊天', icon: <FileTextOutlined style={{ fontSize: 13 }} />, onClick: () => onSummarizeSession(item.id) },
                          { key: 'rename', label: '重命名', icon: <EditOutlined style={{ fontSize: 13 }} />, onClick: () => onStartRename(item) },
                          { key: 'delete', label: '删除', icon: <DeleteOutlined style={{ fontSize: 13 }} />, danger: true, onClick: () => onDeleteSession(item.id) }
                        ]
                      }}
                      trigger={['click']}
                    >
                      <button className="xtsql-icon-btn" title="更多操作">
                        <MoreOutlined />
                      </button>
                    </Dropdown>
                  </div>
                  </div>
                </Tooltip>
              ))}
              {loadingMoreSessions && (
                <div className="xtsql-sider-loading">加载中...</div>
              )}
              {!hasMoreSessions && sessions.length > 0 && sessions.length >= sessionsTotal && sessionsTotal > 0 && (
                <div className="xtsql-sider-end">— 已显示全部 {sessionsTotal} 条对话 —</div>
              )}
            </>
          )}
        </div>

        {/* 底部：用户卡 + 工具栏 */}
        <div className="xtsql-sider-footer">
          <div className="xtsql-sider-actions">
            {user?.role === 'admin' && (
              <Button icon={<SettingOutlined />} onClick={onConfigClick}>配置</Button>
            )}
            <Button icon={<FolderOutlined />} onClick={onSkillClick}>Skill</Button>
          </div>
          <div className="xtsql-user-card">
            <div className="xtsql-user-avatar">
              {(user?.display_name || user?.username || 'U').slice(0, 1).toUpperCase()}
            </div>
            <div className="xtsql-user-info">
              <div className="xtsql-user-name">{user?.display_name || user?.username || '用户'}</div>
              <div className="xtsql-user-role">{user?.role === 'admin' ? '管理员' : '普通用户'}</div>
            </div>
            <Tooltip title="修改密码">
              <Button type="text" size="small" icon={<LockOutlined />} onClick={onChangePasswordClick} style={{ color: 'var(--xtsql-text-tertiary)' }} />
            </Tooltip>
            <Tooltip title="退出登录">
              <Button
                type="text"
                size="small"
                icon={<LogoutOutlined />}
                onClick={() => {
                  Modal.confirm({
                    title: '确认退出登录？',
                    content: '退出后需要重新登录才能使用。',
                    okText: '退出',
                    cancelText: '取消',
                    onOk: onLogout
                  });
                }}
                style={{ color: 'var(--xtsql-text-tertiary)' }}
              />
            </Tooltip>
          </div>
        </div>
      </div>
    </AntSider>
  );
}
