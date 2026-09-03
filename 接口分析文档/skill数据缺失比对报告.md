# database-table-structure.md 与 Skill 现有数据缺失比对报告

> 生成日期：2026-09-03
> 比对对象：[接口分析文档/database-table-structure.md](database-table-structure.md)（course 项目，122 张表明细） vs `skills/sql-creator-skill-v2/` 现有数据（table_index 147 表 / field_config 133 个 / DDL 134 个）
> 比对方法：脚本解析文档的表明细（`#### 表名` 节）、字段表（驼峰，已转下划线匹配）、2.4 JOIN 总清单，与 table_index / field_config / DDL 三方比对。临时脚本已删除，结果全量记录于本文。

## 结论速览

| 组 | 内容 | 数量 | 处理建议 |
|---|---|---|---|
| A | 文档有明细、skill 完全缺失的表 | **72** | 待定业务范围后决定是否纳入 |
| B | 仅总览提到、无明细节且 skill 也没有的表 | 0 | 无 |
| C | 交集表中，文档有而 DDL/field_aliases 没有的字段 | **29** | 分三类：核实真实新列 / 忽略计算字段 / 误报 |
| D | JOIN 清单中双侧 VA 均未覆盖 | 85 | 其中 77 条涉及 A 组缺失表，暂缓 |
| D2 | D 中双方表均已存在、可立即补 VA 的 | **8** | **优先处理** |

---

## A. 表级缺失（72 张，按文档业务域归类）

| 业务域 | 缺失表 | 数量 |
|---|---|---|
| 用户与组织 | edu_student_praise、edu_customer、edu_global_config | 3 |
| 教师管理 | edu_teacher_annex、edu_teacher_class_type、edu_teacher_class_subject_name、edu_teacher_school、edu_teacher_handbook、lark_sync_log | 6 |
| 课程与排课 | edu_student_timetable、edu_course_exam_subject_tag、edu_pre_study、edu_pre_study_student、edu_cancel_pre_study_notice、edu_task、edu_task_feed、exams_year_apply_info | 8 |
| 成绩管理 | edu_achievement、edu_achievement_type、edu_achievement_rule、edu_achievement_annex、edu_achievement_knowledge、edu_achievement_teacher | 6 |
| 教学反馈与留存 | edu_teacher_feedback、edu_feed_teacher、edu_feed_assistant、edu_feedback_annex、edu_feedback_knowledge、edu_retention_detail、edu_retention_stats | 7 |
| 试卷与题库 | t_course_homework、t_exam_paper、t_exam_paper_course、t_exam_paper_config、t_exam_paper_question、t_exam_paper_question_detail、t_exam_paper_knowledge、t_exam_paper_student、tk_paper_topic（注：t_exam_result_rule 已有） | 9 |
| 自习课 | self_study_course_config、edu_self_study_course、edu_self_study_course_detail、edu_self_study_feedback、edu_self_study_feedback_attachments、edu_self_study_feedback_attachments_content | 6 |
| 报告与统计 | edu_study_report、edu_study_report_school、t_study_statistics、t_study_statistics_homework、t_study_statistics_knowledge、t_graduation_report、monthly_communication、monthly_communication_file、planning_report、planning_report_file | 10 |
| 留学业务 | study_abroad_student_info_temp、crm_school_major | 2 |
| 留学系统配置 | abroad_search_criteria_template、abroad_user_custom_filter、abroad_user_defined_field | 3 |
| 消息与通知 | sms_wx_tpl、sms_wx_tpl_field、sms_wx_msg、sms_wx_msg_receiver、sms_wx_my_msg、abroad_message_template、abroad_message_notice | 7 |
| 新签礼包 | new_sign_gift_record、new_sign_gift_push_log、new_sign_gift_operation_log、new_sign_gift_record_sync_cursor | 4 |
| 通用附件 | edu_watermark_annex | 1 |

**决策要点**：是否纳入取决于 agent 的服务范围。当前域路由只覆盖 CRM/订单/排课/留学主线；成绩、题库、报告、消息通知是大幅扩域（agent_max_tool_calls、SKILL.md 域清单、table_index 体积都会受影响）。可按域逐步导入，不必一次全上。

---

## C. 字段级差异（29 个，三类）

### C① 疑似真实新列，DDL 快照过期（16 个）—— 建议对真实库核实后更新 DDL

| 表 | 字段（文档驼峰） | 推测实际列名 | 文档注释 |
|---|---|---|---|
| edu_student | bankAccount | bank_account | 银行账号 |
| edu_student | bankAccountStatus | bank_account_status | 银行账号是否注销：0-初始化 1-有效 2-注销 |
| edu_student | updateMyUserId | update_my_user_id | 通过小程序更新数据时的微信用户注册id |
| edu_student | myUserUpdateTime | my_user_update_time | 通过小程序更新数据的时间 |
| edu_student | parentInfo | parent_info | 家长情况 |
| edu_student | studentCode | student_code | 学生编码 |
| edu_student | org | org | 组织：0-学通 1-科桥 2-科勒 |
| edu_student | applicationSeason | application_season | 申请季（如 2026-2027） |
| study_abroad_planning_info | currentSchoolId | current_school_id | 在读学校ID（新数据保存 CRM 学校库 ID，历史数据可能为空） |
| study_abroad_planning_info | targetSchoolId | target_school_id | CRM 学校库目标学校 ID |
| study_abroad_proofread_book | targetSchoolId | target_school_id | CRM 学校库目标学校 ID |
| study_abroad_proofread_book | majorId | major_id | CRM 学校库专业 ID |
| edu_course_exam_subject_name | tkKnowledgeNewId | tk_knowledge_new_id | 知识点 id（四级科目和知识点 tk_knowledge 做关联） |
| edu_course_exam_subject_name | title | title | 知识点标题（查询用） |
| tk_knowledge_new | mechanismId / examinationId / subjectId / operator | mechanism_id / examination_id / subject_id / operator | 课程id / 考试局id / 科目id / 操作人 |
| edu_teacher | other | other | 其他 |

核实方式建议：`SHOW COLUMNS FROM <table>` 对真实库比对（后端 mysqlPool 现成连接），确认存在则同步更新 `ddl/{table}.sql`。

### C② 疑似 Mapper 计算字段（12 个）—— 查询结果 DTO 携带，非真实列，**不建议补入 DDL**

| 表 | 字段 | 文档注释 | 判断依据 |
|---|---|---|---|
| edu_study_student | feedbackId | 反馈 id | DDL 无此列，疑为 JOIN 查询带出 |
| edu_study_student | status | 状态 | 同上 |
| edu_study_student | campusSchoolId | 校区 id | 同上 |
| edu_study_student | studentIds | 学生ids，用逗号分隔 | 明显是聚合计算字段 |
| edu_study_student | studentName | 学生名称 | JOIN edu_student 带出 |
| edu_study_student | date | 课程日期 | 计算字段 |
| study_abroad_proofread_book | admissionTimeStr | 入学时间（yyyy-MM-dd） | `*Str` 后缀 = 格式化结果 |
| study_abroad_proofread_book | applicationDeadlineStr | 申请截止时间（yyyy-MM-dd） | 同上 |
| study_abroad_proofread_book | operatorUserName | 操作人名称 | JOIN admin_user 带出 |
| study_abroad_proofread_book | statusName | 定校状态名称 | 枚举翻译字段 |
| order_student | orderCreatedTime | 订单创建时间（毫秒时间戳） | 计算字段 |
| order_student | orderStatus | 订单状态 | 计算字段 |
| edu_student_personnel | adminUserName | — | JOIN admin_user 带出 |

### C③ 命名错位误报（1 处，2 个字段）—— 实际列存在，无需处理

| 表 | 文档字段 | 实际列（DDL 已有） | 原因 |
|---|---|---|---|
| edu_study_student | studyId | `edu_study_id` | DO 类字段去掉了 `edu_` 前缀 |
| edu_study_student | studentId | `edu_student_id` | 同上 |
| order_student | orderStudentId | `id`（主键自身） | Mapper 结果对象的别名字段 |

---

## D / D2. JOIN 覆盖缺口

### D2. 双方表均已存在、可立即补 VA 的 8 条（优先）

按影响排序：

| # | JOIN 关系 | 重要性 | 建议补入 |
|---|---|---|---|
| 1 | `study_abroad_planning_info.student_id = edu_student.id` | ★★★ 留学主链，缺它 LLM 无法从留学域连通学生域 | study_abroad_planning_info.json |
| 2 | `study_abroad_planning_info.target_school_id = crm_target_school.id` | ★★ | study_abroad_planning_info.json |
| 3 | `study_abroad_planning_info.current_school_id = crm_current_school.id` | ★★ | study_abroad_planning_info.json |
| 4 | `study_abroad_proofread_book.target_school_id = crm_target_school.id` | ★★ | study_abroad_proofread_book.json |
| 5 | `study_abroad_planning_info.edu_student_type_id = edu_student_type.id` | ★ | study_abroad_planning_info.json |
| 6 | `study_abroad_operate_log.operator_id = admin_user.id` | ★ | study_abroad_operate_log.json |
| 7 | `edu_teacher.id = edu_study.edu_admin_user_id` | ★（注意语义：排课的教务是 teacher 表关联） | edu_study.json 或 edu_teacher.json |
| 8 | `edu_student_personnel.admin_user_id = admin_user_campus.admin_user_id` | ★ | edu_student_personnel.json |

补 VA 注意事项：
- `join_condition` 按现有 field_config 风格写全表名（如 `edu_student.id = study_abroad_planning_info.student_id`），不用别名；
- `type` 按实际基数（多为 many_to_one）；
- #1 若确认 planning_info 的 DDL 没有 student_id 列（见 C① 核实项），需先核实真实库再补，避免写出对不上的 JOIN；
- 禁止包含 `fields_mapping`（项目硬约束）。

### D. 其余 77 条未覆盖 JOIN

涉及 A 组 72 张缺失表（edu_achievement*、t_exam_paper*、edu_self_study*、sms_wx_*、new_sign_gift_* 等），表纳入后再一并补 VA，本文档 2.4 节即是现成的 JOIN 证据来源。

---

## 建议处理顺序

1. **D2 的 8 条 VA**（C① 先核实 planning_info.student_id 等 4 个留学域字段是否真实存在，再补）；
2. **C① 组 16 个字段**：`SHOW COLUMNS` 对真实库核实 → 更新对应 `ddl/*.sql`；
3. **A 组 72 张表**：按业务域决策纳入节奏（建议先讨论哪些域在服务范围内）；
4. C② / C③ 不处理。

## 附：比对口径说明

- 字段匹配集合 = 该表 DDL 列名 ∪ field_aliases 键名（均转小写）；
- 文档字段先驼峰转下划线再匹配（如 `campusSchoolId` → `campus_school_id`）；
- 文档中 `createdTime / updateTime`、`del / rel` 类合并行已拆分；
- "表"以文档 `#### ` 标题为准（122 个，含 2 个多表合一标题已拆分），总览清单 121 张全部有明细或已存在于 table_index。
