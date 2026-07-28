# XTSQLQueryAgent SQL 生成流程 — Mermaid 图集

## 1. 整体架构（模块 + 数据流）

```mermaid
flowchart TB
    subgraph FE["[前端 React + Electron]"]
        UI["UserInput<br/>UserChoiceDialog<br/>ConfirmTagDialog<br/>SqlDisplay<br/>ReasoningStream<br/>HistorySidebar"]
    end

    subgraph RTE["[Express 路由层 routes/*.js]"]
        direction TB
        Q["query.js<br/>POST /api/query/generate"]
        A["auth.js<br/>authRequired"]
        S["skill.js<br/>POST /api/skills/create-table-files"]
    end

    subgraph LLM["[核心 LLM 服务 services/llm.js]"]
        direction TB
        GEN["generateSQLWithLangChainStreamGen_BAK<br/>(async generator)"]
        SUB1["resetPerQuestionRegistryFlags"]
        SUB2["buildToolCallChecklistMessage"]
        SUB3["compactConsumedToolResults"]
        SUB4["checkAndFilterDuplicateCall"]
        SUB5["recordToolCall"]
        SUB6["splitThinkingFromContent"]
        GEN --> SUB1
        GEN --> SUB2
        GEN --> SUB3
        GEN --> SUB4
        GEN --> SUB5
        GEN --> SUB6
    end

    subgraph TOOL["[工具层 services/toolFuncs.js]"]
        T1["get_domain_index"]
        T2["get_sliced_index"]
        T3["get_table_schema"]
        T4["get_table_ddl"]
        T5["request_tag_confirmation"]
        T6["request_user_choice"]
        T7["validate_sql_fields"]
    end

    subgraph DB["[持久化层]"]
        D1[("SQLite: sessions<br/>messages<br/>llm_messages")]
        D2[("MySQL Pool:<br/>业务库查询")]
    end

    subgraph SKILL["[SKILL 配置<br/>skills/sql-creator-skill-v2/]"]
        K1["SKILL.md<br/>(System Prompt)"]
        K2["table_index.json<br/>domains/*.json<br/>field_config/*.json<br/>ddl/*.sql"]
    end

    subgraph EXT["[外部 LLM API]"]
        E1["DeepSeek / OpenAI<br/>POST /chat/completions<br/>stream: true, thinking: enabled"]
    end

    FE -->|HTTPS / SSE| Q
    Q --> A
    Q -->|invoke| GEN
    Q --> S
    S -->|读写| K2
    GEN -->|读 messages| D1
    GEN -->|读写| K1
    GEN -->|读写| K2
    GEN -->|调用| TOOL
    TOOL -->|读| K2
    GEN -->|fetch SSE| E1
    GEN -->|业务查询| D2
    GEN -->|UPDATE| D1
    Q -->|SSE 流| FE
```

---

## 2. 端到端时序图（用户问 → 拿到 SQL）

```mermaid
sequenceDiagram
    autonumber
    actor U as 用户
    participant FE as 前端 (React)
    participant Q as query.js (路由)
    participant L as llm.js (主循环)
    participant DB as SQLite
    participant API as DeepSeek/OpenAI
    participant T as 工具层

    U->>FE: 输入 question
    FE->>Q: POST /api/query/generate {question, sessionId}
    Q->>Q: authRequired 验证 JWT
    Q->>Q: ensureSession / sessionBelongsToUser
    Q->>DB: INSERT messages(role=user)
    Q->>Q: loadSkillMd() 读 SKILL.md
    Q->>Q: setNoDelay + flushHeaders (SSE)
    Q->>Q: 5min 整体超时 + abort 监听

    Q->>L: generateSQL...BAK(question, signal, sessionId, user)
    L->>L: resetPerQuestionRegistryFlags(reg)
    L->>DB: loadMessagesFromDb(sessionId)
    DB-->>L: savedMessages (历史)
    L->>L: 拼 system + 追加新 user question

    loop while (maxToolCalls-- > 0)
        L->>L: buildChecklist(reg) → 临时 system 消息
        L->>L: compactConsumedToolResults(messages)
        L->>L: prune tools (基于 reg)
        L->>API: POST /chat/completions (stream=true)

        API-->>L: SSE delta (reasoning_content / content / tool_calls)
        L->>L: 累积 streamToolCalls / responseText
        L->>L: splitThinkingFromContent (剥离误倒 thinking)
        L->>L: messages.push(assistantMsg)
        L->>DB: UPDATE llm_messages

        alt LLM 调用了工具
            L->>L: 阶段1 prepare (parse / 幻觉拦截 / 重复检查)
            L->>T: 阶段2 Promise.all (并行执行工具)
            T-->>L: rawResult
            L->>L: recordToolCall + 写 reg.validateSqlFields* (若是 validate_sql_fields)
            L->>L: 阶段3 写回 messages (tool role)
        else LLM 直接输出内容
            L->>L: continue
        end

        opt request_user_choice 被调用
            L->>L: pendingUserChoiceList 非空 → break
        end
    end

    L-->>Q: yield done {sql, message, userChoiceRequest?}
    Q->>Q: 解析 ```sql``` 块提取 SQL
    Q->>DB: INSERT messages(role=assistant, sql, tokens)
    Q->>DB: UPDATE sessions.total_tokens
    Q-->>FE: SSE done 事件
    FE-->>U: 显示 SQL + 思考过程
```

---

## 3. sessionToolRegistries 状态机

```mermaid
stateDiagram-v2
    direction TB

    [*] --> MapEmpty: 进程启动

    state "sessionToolRegistries (Map<sessionId, reg>)" as Map {
        state "无 sessionId" as NoSid
        state "getOrCreateRegistry(sid)" as Get
        state "reg 已存在" as Exist
        state "reg 不存在 → new reg" as New

        [*] --> NoSid
        NoSid --> Get: 提供 sessionId
        Get --> Exist: Map.has(sid)
        Get --> New: !Map.has(sid)
        New --> Exist
        Exist --> Exist: 读写字段
    }

    Map --> Clear: clearSessionRegistry(sid)
    Clear --> MapEmpty: DELETE from Map

    state "reg 字段" as Fields {
        direction TB
        state "会话级持久 (跨问题保留)" as Persist {
            P1[getDomainIndexCalled: bool]
            P2[slicedDomains: Set]
            P3[tableSchema: Set]
            P4[tableDdl: Set]
            P5[termConfirmed: Set]
            P6[userChoiceAsked: Map]
            P7[getTablesCalled: bool]
        }
        state "问题级独立 (per-question 重置)" as PerQ {
            Q1[validateSqlFieldsCalled: bool]
            Q2[validateSqlFieldsPassed: bool]
            Q3[validateSqlFieldsErrorCount: number]
        }
    }

    Map --> Fields

    state "PerQ 状态转换" as PerQTrans {
        direction TB
        [*] --> Reset: 新 user 消息 → resetPerQuestionRegistryFlags
        Reset --> LlmCall: validateSqlFieldsCalled=false, Passed=false, ErrorCount=0
        LlmCall --> Pass: rawResult.valid=true
        LlmCall --> Fail: rawResult.valid=false
        Fail --> LlmCall: 重写 SQL 再调
        Pass --> [*]: LLM 输出 SQL
    }
```

---

## 4. 单轮 LLM 请求详细流程（while 单次迭代）

```mermaid
flowchart TD
    A[while 循环开始<br/>maxToolCalls > 0] --> B[1. 拼 checklist 消息<br/>buildToolCallChecklistMessage]
    B --> C[2. 折叠已消费工具结果<br/>compactConsumedToolResults]
    C --> D[3. 工具剪枝<br/>get_domain_index / get_sliced_index]
    D --> E[4. 构造 requestParams<br/>model, messages, tools, stream, thinking]
    E --> F[5. fetch LLM<br/>withTimeout FETCH=60s / READ=30s]
    F --> G[6. 逐行解析 SSE<br/>累积 streamToolCalls / responseText / reasoning]
    G --> H[7. 后处理<br/>splitThinkingFromContent]
    H --> I[8. 构造 assistant 消息<br/>messages.push + saveMessagesToDb]
    I --> J{validToolCalls<br/>非空?}

    J -->|否| K[maxToolCalls-- → continue]
    J -->|是| L[阶段1 prepare 同步]

    L --> L1[JSON.parse arguments]
    L1 --> L1a{parseError?}
    L1a -->|是| L1b[execError: 参数解析失败]
    L1a -->|否| L2{!toolsMap.has?}
    L1b --> L4
    L2 -->|是| L3[execError: 工具不存在]
    L2 -->|否| L3a{!availableToolNames.has?<br/>被剪枝}
    L3 --> L4
    L3a -->|是| L3b[execError: 已剪枝 禁止重复]
    L3a -->|否| L3c[dupCheck = checkAndFilterDuplicateCall]
    L3b --> L4
    L3c --> L4[阶段2 Promise.all 并行执行]

    L4 --> M[await p.tool.func args]
    M --> N{toolName ==<br/>validate_sql_fields?}
    N -->|是| N1[写 reg.validateSqlFields<br/>Called / Passed / ErrorCount]
    N -->|否| O[recordToolCall 写注册表]
    N1 --> O
    O --> P[阶段3 写回 messages 按 validToolCalls 原始顺序]

    P --> P1{dupCheck.block?}
    P1 -->|是| P2[messages.push tool content=拦截消息]
    P1 -->|否| P3{execError?}
    P3 -->|是| P4[messages.push tool content=Error]
    P3 -->|否| P5[messages.push tool content=result]
    P5 --> P6{toolName ==<br/>request_user_choice?}
    P6 -->|是| P7[pendingUserChoiceList.push payload]
    P6 -->|否| P8[继续下一个]
    P7 --> P8
    P2 --> P8
    P4 --> P8

    P8 --> Q{pendingUserChoiceList<br/>非空?}
    Q -->|是| R[break → TURN 1 终止]
    Q -->|否| K
    K --> A

    R --> S[yield done userChoiceRequest]
```

---

## 5. 工具剪枝决策树

```mermaid
flowchart TD
    Start[prunedTools 计算<br/>输入: toolsDefinition + reg] --> GetDi{get_domain_index?}
    GetDi -->|是| GetDiCheck{reg.getDomainIndex<br/>Called?}
    GetDiCheck -->|true| GetDiPrune[剪掉 ❌]
    GetDiCheck -->|false| GetDiKeep[保留 ✅]
    GetDi -->|否| GetSi{get_sliced_index?}

    GetSi -->|是| GetSiCheck{reg.slicedDomains<br/>.size > 0?}
    GetSiCheck -->|true| GetSiPrune[剪掉 ❌]
    GetSiCheck -->|false| GetSiKeep[保留 ✅]
    GetSi -->|否| GetVal{validate_sql_fields?}

    GetVal -->|是| GetValKeep[保留 ✅<br/>ALWAYS KEEP<br/>任何轮次包括 Round 0]
    GetVal -->|否| OtherCheck{其他工具?}
    OtherCheck -->|是| OtherKeep[保留 ✅]
    OtherCheck -->|否| End[prunedTools 完成]

    GetDiPrune --> End
    GetDiKeep --> End
    GetSiPrune --> End
    GetSiKeep --> End
    OtherKeep --> End

    End -.->|LLM 调被剪枝工具| Block[阶段1 拦截<br/>execError: 已剪枝 禁止重复]
```

---

## 6. SSE 事件协议

```mermaid
sequenceDiagram
    participant LLM as 后端 llm.js
    participant SSE as SSE 通道
    participant FE as 前端
    participant DB as SQLite

    Note over LLM,SSE: while 循环中持续推送

    LLM->>SSE: chunk (content delta)
    SSE->>FE: data: {type:chunk, content}
    Note right of FE: 实时显示

    LLM->>SSE: reasoning_chunk (思考 delta)
    SSE->>FE: data: {type:reasoning_chunk, content}
    Note right of FE: 实时显示思考<br/>不入 DB

    LLM->>SSE: reasoning_done (整段思考)
    SSE->>DB: INSERT messages(role=LLM)
    Note right of FE: 不推 UI<br/>仅入 DB 历史回显

    LLM->>SSE: message_final (剥离 thinking 后)
    SSE->>FE: data: {type:message_final, content, extraThinking}
    Note right of FE: 更新 assistant 气泡

    LLM->>SSE: usage (每 round 1 次)
    SSE->>DB: INSERT messages(role=usage, prompt/completion/total)
    Note right of FE: 不推 UI<br/>累加 token 统计

    LLM->>SSE: tool (LLM 决定调工具)
    SSE->>DB: INSERT messages(role=LLM)
    SSE->>FE: data: {type:tool, log}

    LLM->>SSE: tool_return (工具执行完)
    SSE->>DB: INSERT messages(role=tool_return)
    SSE->>FE: data: {type:tool_return, log}

    LLM->>SSE: error (异常)
    SSE->>FE: data: {type:error, content}

    LLM->>SSE: done (终止)
    SSE->>FE: data: {type:done, sql, message, totalTokens,<br/>elapsedMs, user_choice_request?, confirm_tag_add?}

    Note over LLM,DB: 同时 LLM 持续写 llm_messages 表<br/>每轮 assistantMsg 后 UPDATE
```

---

## 7. 消息持久化双轨

```mermaid
flowchart LR
    subgraph SRC["LLM 真实上下文 (内存)"]
        M["messages: [<br/>  {role:system, content:SKILL.md},<br/>  {role:user, content:Q1},<br/>  {role:assistant, tool_calls:[...]},<br/>  {role:tool, content:...},<br/>  {role:assistant, content:Q1 答},<br/>  {role:user, content:Q2},<br/>  ...<br/>]"]
    end

    SRC -->|saveMessagesToDb| DB1[("llm_messages 表<br/>session_id → messages JSON<br/>message_tokens<br/>updated_at")]
    SRC -->|JSON.parse + stringify| RAM[("进程内存 lastMessages<br/>GET /api/query/messages<br/>调试接口使用")]

    SRC -->|SSE 事件 + 最终落库| DB2[("messages 表<br/>role: user/assistant/<br/>       LLM/tool/tool_return/usage<br/>content, sql, results,<br/>prompt_tokens, completion_tokens,<br/>elapsed_ms")]

    DB1 -.->|loadMessagesFromDb| SRC

    subgraph USAGE["用途"]
        U1["llm_messages → 跨请求恢复<br/>LLM context (TURN 2 / 新问题)"]
        U2["lastMessages → 临时调试<br/>(开发期)"]
        U3["messages → 前端历史侧边栏<br/>/api/query/messages/:sid"]
    end

    DB1 --> U1
    RAM --> U2
    DB2 --> U3
```

---

## 8. 数据流总览（一张图横贯）

```mermaid
flowchart LR
    subgraph IN["入口"]
        I1[question + sessionId]
    end

    subgraph MID["LLM 主循环"]
        direction TB
        M1[拼 checklist]
        M2[compact 折叠]
        M3[prune 剪枝]
        M4[fetch LLM SSE]
        M5[解析 SSE]
        M6[三阶段执行工具]
    end

    subgraph OUT["出口"]
        O1[yield done]
        O2[query.js 解析 sql]
        O3[落库 + SSE done]
    end

    I1 --> M1 --> M2 --> M3 --> M4 --> M5 --> M6 --> O1 --> O2 --> O3

    M1 -.读 reg.-> REG[("sessionToolRegistries")]
    M3 -.读 reg.-> REG
    M6 -.写 reg.-> REG
    M6 -.读 SKILL.-> SK[("sql-creator-skill-v2/")]
    M4 -.HTTP.-> API[("DeepSeek API")]
    O3 -.写 messages.-> DB1[("messages")]
    O3 -.UPDATE.-> DB2[("llm_messages")]
    O3 -.UPDATE.-> DB3[("sessions.total_tokens")]
```

---

## 渲染说明

把以上任一 ```` ```mermaid ```` 代码块粘贴到以下任一工具即可查看：

- **Trae / VS Code**：装 `Markdown Preview Mermaid Support` 扩展，右键预览
- **GitHub / GitLab**：直接渲染
- **Obsidian / Typora**：原生支持
- **在线渲染**：<https://mermaid.live>（粘贴后导出 PNG/SVG/PDF）

如果想要 PlantUML / Graphviz DOT / 或我直接出 PNG 图片，告诉我换哪种。
