# field_aliases 与 DDL 注释重复清单

> 生成方式：field_aliases 中某别名与该字段 DDL COMMENT（忽略空白/大小写/全角斜杠）相同时视为重复。
> **改动规则**：数组内删掉与注释相同的别名；删完数组为空则整条删除该字段的 field_aliases 条目。

## 统计

- 涉及配置文件：**35** 个
- 重复条目：**81** 处
- 预估节省：约 **868** 字符/次 get_table_schema 调用（含 JSON 开销）

---

### admin_character.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `characterName` | ["角色名称"] | 角色名称 | （整条删除） |

### admin_department.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `name` | ["一级部门名称"] | 一级部门名称 | （整条删除） |

### admin_department_children.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `department_id` | ["一级部门ID"] | 一级部门id | （整条删除） |

### admin_user.json（3 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `character_id` | ["角色ID"] | 角色ID | （整条删除） |
| `department_id` | ["部门ID","二级部门ID"] | 部门ID | ["二级部门ID"] |
| `user` | ["用户名"] | 用户名 | （整条删除） |

### admin_user_campus.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `edu_campus_id` | ["校区ID"] | 校区ID | （整条删除） |

### admin_user_channel.json（8 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `category` | ["渠道类别"] | 渠道类别 | （整条删除） |
| `to_company` | ["所在公司"] | 所在公司 | （整条删除） |
| `to_post` | ["所在岗位"] | 所在岗位 | （整条删除） |
| `responsible_admin_user_id` | ["协作人用户ID"] | 协作人用户ID | （整条删除） |
| `collection_name` | ["收款账户名"] | 收款账户名 | （整条删除） |
| `contract_time` | ["签约日期"] | 签约日期 | （整条删除） |
| `channel_phone` | ["渠道联系方式"] | 渠道联系方式 | （整条删除） |
| `remark` | ["渠道协议重要条款"] | 渠道协议重要条款 | （整条删除） |

### crm_channels.json（8 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `channel_code` | ["渠道编码","渠道代码"] | 渠道代码 | ["渠道编码"] |
| `channel_name` | ["渠道名称"] | 渠道名称 | （整条删除） |
| `channel_parent_id` | ["父级渠道ID"] | 父级渠道ID | （整条删除） |
| `channel_create_user_id` | ["渠道创建人ID"] | 渠道创建人ID | （整条删除） |
| `channel_update_user_id` | ["渠道更新人ID"] | 渠道更新人ID | （整条删除） |
| `org` | ["所属事业部","组织"] | 所属事业部 | ["组织"] |
| `sort_num` | ["排序字段"] | 排序字段 | （整条删除） |
| `version` | ["版本号"] | 版本号 | （整条删除） |

### customer_auto_assign_result.json（7 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `customer_code` | ["线索编码","客户编码"] | 线索编码 | ["客户编码"] |
| `admin_user_id` | ["分配员工ID"] | 分配员工id | （整条删除） |
| `business_status` | ["线索业务状态"] | 线索业务状态 | （整条删除） |
| `rank_num` | ["员工序号"] | 员工序号 | （整条删除） |
| `rank_code` | ["队列编码"] | 队列编码 | （整条删除） |
| `lesson_intention_code` | ["课程意向编码"] | 课程意向编码 | （整条删除） |
| `campus_value` | ["有效校区"] | 有效校区 | （整条删除） |

### customer_label.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `code` | ["标签编码","标签code"] | 标签编码 | ["标签code"] |

### edu_campus.json（2 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `name` | ["校区名称"] | 校区名称 | （整条删除） |
| `manager_id` | ["校区负责人ID","负责人ID"] | 校区负责人id | ["负责人ID"] |

### edu_course.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `name` | ["课程名称","一级科目名称","课程"] | 课程名称 | ["一级科目名称","课程"] |

### edu_course_exam.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `name` | ["考试局名称","二级科目名称","考试局"] | 考试局名称 | ["二级科目名称","考试局"] |

### edu_course_exam_subject.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `name` | ["科目名称","三级科目名称","科目"] | 科目名称 | ["三级科目名称","科目"] |

### edu_course_exam_subject_name.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `rule_id` | ["成绩规则ID","规则ID"] | 成绩规则 id | ["规则ID"] |

### edu_room.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `name` | ["班级名称","教室名称"] | 班级名称 | ["教室名称"] |

### edu_room_study.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `edu_study_id` | ["排课ID"] | 排课ID | （整条删除） |

### edu_study.json（2 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `edu_campus_school_class_id` | ["教室ID"] | 教室ID | （整条删除） |
| `admin_user_id` | ["操作人ID","创建人ID"] | 操作人ID | ["创建人ID"] |

### edu_study_feedback.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `edu_study_id` | ["排课ID"] | 排课ID | （整条删除） |

### edu_study_feedback_type.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `name` | ["反馈类型名称","反馈名称"] | 反馈名称 | ["反馈类型名称"] |

### edu_teacher_work.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `admin_user_id` | ["老师ID"] | 老师ID | （整条删除） |

### edu_video.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `edu_study_id` | ["排课ID"] | 排课ID | （整条删除） |

### goods_list.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `name` | ["商品名称"] | 商品名称 | （整条删除） |

### order_approval_configure_user.json（3 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `order_approval_configure_id` | ["审批流程配置ID","流程ID"] | 流程ID | ["审批流程配置ID"] |
| `level` | ["审批等级"] | 审批等级 | （整条删除） |
| `admin_user_id` | ["审批人ID","用户ID"] | 用户ID | ["审批人ID"] |

### order_approval_order_student_log.json（3 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `level` | ["审批等级","审批级别"] | 审批等级 | ["审批级别"] |
| `admin_user_id` | ["审批人ID","订单审批人ID"] | 审批人ID | ["订单审批人ID"] |
| `created_time` | ["审批时间","订单审批时间","创建时间"] | 创建时间 | ["审批时间","订单审批时间"] |

### order_entry.json（2 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `name` | ["项目名称","订单项目名称"] | 项目名称 | ["订单项目名称"] |
| `simple` | ["字母简称","项目简称"] | 字母简称 | ["项目简称"] |

### order_pattern.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `include_calc` | ["是否纳入渠道佣金结算统计"] | 是否纳入渠道佣金结算统计 | （整条删除） |

### order_student_reject.json（5 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `order_student_id` | ["订单ID","学生订单ID"] | 订单ID | ["学生订单ID"] |
| `admin_user_id` | ["审批人ID","驳回人ID"] | 审批人ID | ["驳回人ID"] |
| `level` | ["审批等级"] | 审批等级 | （整条删除） |
| `remarks` | ["驳回原因","驳回备注","备注"] | 备注 | ["驳回原因","驳回备注"] |
| `created_time` | ["驳回时间","创建时间"] | 创建时间 | ["驳回时间"] |

### study_abroad_apply_online_account_info.json（3 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `email` | ["网申邮箱","申请邮箱"] | 网申邮箱 | ["申请邮箱"] |
| `ucas_account` | ["UCAS账号","UCAS账户"] | UCAS账号 | ["UCAS账户"] |
| `ucas_pwd` | ["UCAS密码","UCAS账户密码"] | UCAS密码 | ["UCAS账户密码"] |

### study_abroad_copy_writer.json（4 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `transfer_teacher_id` | ["转案老师ID"] | 转案老师ID | （整条删除） |
| `copywriting_teacher_id` | ["文案老师ID"] | 文案老师ID | （整条删除） |
| `application_major` | ["专业方向","申请专业"] | 申请专业 | ["专业方向"] |
| `study_abroad_major_id` | ["专业方向ID"] | 专业方向ID | （整条删除） |

### study_abroad_document.json（2 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `application_major` | ["申请专业","专业方向"] | 申请专业 | ["专业方向"] |
| `study_abroad_major_id` | ["专业方向ID"] | 专业方向ID | （整条删除） |

### study_abroad_planning_info.json（2 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `clue_number` | ["线索编号"] | 线索编号 | （整条删除） |
| `study_abroad_major_id` | ["专业方向ID"] | 专业方向ID | （整条删除） |

### study_abroad_proofread_book.json（4 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `application_major` | ["专业方向","申请专业"] | 申请专业 | ["专业方向"] |
| `course_code` | ["课程代码","专业代码"] | 课程代码 | ["专业代码"] |
| `course_name` | ["课程名称","专业名称"] | 课程名称 | ["专业名称"] |
| `study_abroad_major_id` | ["专业方向ID"] | 专业方向ID | （整条删除） |

### tk_knowledge_course.json（1 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `tk_knowledge_id` | ["知识点ID"] | 知识点id | （整条删除） |

### tk_knowledge_new.json（2 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `parent_id` | ["父级id","上级ID"] | 父级id | ["上级ID"] |
| `title` | ["知识点标题","知识点"] | 知识点标题 | ["知识点"] |

### t_exam_result_rule.json（3 处）

| 字段 | field_aliases（现值） | DDL 注释 | 建议改后 |
|---|---|---|---|
| `subject_name_id` | ["四级科目id","科目名称id"] | 四级科目 id | ["科目名称id"] |
| `low_limit` | ["下限"] | 下限 | （整条删除） |
| `up_limit` | ["上限"] | 上限 | （整条删除） |
