# XTSQLQueryAgent 文档中心（V1）

> 版本：V1 · 整理日期：2026-08-12
> 本文档集面向**新接手开发者 / 其他 AI / 运维人员**，基于 `docs/` 下既有材料 + 当前代码（`backend/`、`frontend/`、`electron/`、`skills/`）逐文件核对整理。

## 一、项目一句话定位

**通过自然语言与 AI Agent 对话，自动生成并执行面向公司 MySQL 数据库的只读查询（SELECT/WITH），并围绕“SQL 生成 → 校验 → 执行 → EXPLAIN → AI 分析 → 收藏复用”提供完整工具链的桌面/网页应用。**

- 形态：Web（Vite + React）与桌面（Electron 壳，内嵌启动后端）
- 后端：Node.js + Express + SQLite（本地业务库）+ MySQL（目标业务库）
- LLM：默认 DeepSeek（Chat Completions / Responses 双协议实现）

## 二、文档清单

| 文档 | 内容 | 适合读者 |
|---|---|---|
| [01-功能说明.md](./01-功能说明.md) | 全部功能点、角色权限、UI 特性、功能-代码映射 | 产品 / 测试 / 新接手者 |
| [02-架构设计.md](./02-架构设计.md) | 技术栈、模块划分、目录结构、SQLite 数据模型、Skill 资产模型、配置体系、日志体系、安全设计 | 架构评审 / 开发 |
| [03-核心流程.md](./03-核心流程.md) | 自然语言查询全链路（SSE 协议、Agent 循环、工具三阶段）、SQL 执行/EXPLAIN、认证、收藏、Skill 管理、Electron 启动 | 开发 / 调试 |
| [04-API参考.md](./04-API参考.md) | 全部 REST 接口与 SSE 事件协议，含请求/响应示例与错误码 | 联调 / 二次开发 |
| [05-操作手册.md](./05-操作手册.md) | 环境要求、启动/打包、配置面板、日常运维、Skill 维护、常见故障排查 | 部署 / 运维 / 管理员 |
| [06-问题清单.md](./06-问题清单.md) | 已知问题、历史问题追踪、风险与改进建议（含本次分析新发现） | 规划 / 排期 |
| [07-开发指南.md](./07-开发指南.md) | 代码地图、关键函数索引、扩展点（新增工具/注册表字段/换 Provider）、开发约定与陷阱 | 开发者 / 其他 AI |

## 三、快速上手（30 秒）

```bash
# 1) 环境要求：Node 24（后端 better-sqlite3 为 Node 24 ABI，详见 05-操作手册）
#    本机 nvm 路径：D:\nvm（含 v24.11.0）

# 2) 安装依赖
#    先确保当前 Node 是 24.x（本机在 D:\nvm，示例：$env:PATH = 'D:\nvm\v24.11.0;' + $env:PATH）
npm install
cd backend && npm install
cd ../frontend && npm install
cd ..

# 3) 一键启动（先起后端 5002，健康检查通过后再起前端 5173）
npm run dev

# 4) 浏览器访问
http://localhost:5173
```

首次启动自动创建默认管理员：`admin / admin123`（**生产环境务必立即改密，并设置 `ALLOW_DEFAULT_ADMIN=false`**）。

## 四、当前状态速览（2026-08-12 核对）

- 后端 9 组路由 / 21 个业务服务模块 / 30 个测试脚本
- 前端 1 个主应用文件（`App.jsx`，约 2497 行）+ 13 个组件/上下文/工具模块
- Electron 壳：splash 启动页 + 后端子进程托管 + Cookie 兼容层
- Skill 资产：`table_index.json`（123 张表）、`domain_router_index.json`（10 个域注册）、`domains/`（11 个域文件，其中 `report` 未注册）、`ddl/`（121 个）、`field_config/`（120 个）
- 本地 SQLite：users 8、sessions 338、messages 10028、llm_messages 306、my_queries 9、skill_logs 197（均为核对时实时数据）

> 注意：现有根目录 `README.md`、`docs/执行流程.md`、`docs/agent-flow-mermaid.md` 及 `docs/superpowers/` 下的计划/评审文档是**历史材料**，部分内容已过时（例如工具数量、函数名、Provider 支持度）。本文档集以**当前代码为准**，历史材料作为背景参考，差异详见 [06-问题清单.md](./06-问题清单.md) 与各文档内“与历史文档的差异”小节。

## 五、文档维护约定

1. **每日变更日志**：每天在 [changelog/](./changelog/) 下新增 `YYYY-MM-DD.md`（复制 [_模板.md](./changelog/_模板.md)），记录功能修复 / 迭代优化 / 分析结论 / 文档更新 / 验证方式，便于后期追溯。
2. **功能修复或新增迭代必须同步更新对应文档**：功能行为变化 → [01-功能说明.md](./01-功能说明.md)；接口/协议变化 → [04-API参考.md](./04-API参考.md)；问题修复/新增 → [06-问题清单.md](./06-问题清单.md)（修复项记入“E. 已修复记录”，新问题记入 A 节）；扩展点/陷阱 → [07-开发指南.md](./07-开发指南.md)。
3. 每次涉及核心流程（Agent 循环、SSE 协议、工具集、DB schema、API）的代码变更，请同步更新 `01~04` 对应文档。
4. 新增工具或模块请按 [07-开发指南.md](./07-开发指南.md) 的“代码地图”和扩展点执行，并更新功能-代码映射表。
5. 所有文件使用 **UTF-8（无 BOM）** 编码，中文正文；`docs/V1` 内使用相对链接。
