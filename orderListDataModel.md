# 订单列表数据模型知识库（SQL 生成用）

> 来源：`POST /api/xtorder/orderStudent/list/xuetong/export` 导出接口
> 用途：供 AI 生成订单查询 SQL 时理解表结构、表关系、字段含义、枚举值、业务规则
> 主查询实现：`services/order.js → findOrderList()`；字段中文映射：`controllers/export.js → formatOrderDataFields()`

---

## 一、核心表一览

| 表名 | 别名 | 说明 | 关联主表方式 |
|------|------|------|-------------|
| `order_student` | a | **订单主表** | - |
| `edu_student` | b | 学员 | `a.student_id = b.id` |
| `admin_user` | c | 后台人员（订单创建人） | `a.admin_user_id = c.id` |
| `order_entry` | d | 项目名称配置表 | `a.order_entry_id = d.id` |
| `edu_goods` | e | 产品表 | `a.goods_id = e.id` |
| `edu_campus` | f | 校区表 | `a.edu_campus_id = f.id` |
| `order_type` | h | 订单类型表 | `a.type_id = h.id` |
| `order_pattern` | m | 订单模式表（费用类型） | `a.pattern_id = m.id` |
| `admin_department_children` | n | 部门表（二级） | `c.department_id = n.id` |
| `admin_department` | n1 | 部门表（一级） | `n.department_id = n1.id` |
| `edu_goods_section` | egs | 产品分类 | `e.edu_goods_section_id = egs.id` |
| `edu_student_party` | pp | 学员关系表 | `b.id = pp.student_id` |
| `edu_student_status` | ess | 学员状态 | `b.edu_student_status_id = ess.id` |
| `edu_goods_year` | y | 产品年份/价格体系 | `e.edu_goods_year_id = y.id` |
| `admin_pay_order_student` | apos | 支付单-订单关联表 | `a.id = apos.order_student_id` |
| `order_contract` | oc | 合同签署记录 | `a.id = oc.order_student_id` |
| `edu_student_personnel` | sp | 学员-人员绑定（仅教务订单模式 join） | `sp.student_id = a.student_id` |

## 二、订单主表 `order_student`（a）字段

### 常规字段

| 字段 | 说明 |
|------|------|
| `id` | 订单ID |
| `title` | 订单合同标题 |
| `order_number` | 订单合同编号 |
| `status` | 订单审批状态（枚举：见四） |
| `valid` | 订单生效状态（枚举：见四） |
| `del` | 删除标记，**所有查询必须 `a.del = 0`** |
| `student_id` | 学员ID（→ edu_student.id） |
| `type_id` | 订单类型ID（→ order_type.id） |
| `pattern_id` | 费用类型ID（→ order_pattern.id） |
| `order_entry_id` | 订单项目ID（→ order_entry.id） |
| `goods_id` | 产品ID（→ edu_goods.id） |
| `edu_campus_id` | 校区ID（→ edu_campus.id） |
| `admin_user_id` | 订单创建人ID（→ admin_user.id） |
| `total_amount` | 订单总金额（**单位：分**，÷100=元） |
| `transaction_amount` | 订单实际金额（**分**） |
| `discount` | 订单折扣系数（÷100000=小数） |
| `ht_total_amount` | 合同总金额（**分**） |
| `ht_discount` | 合同折扣（÷100000） |
| `ht_transaction_amount` | 合同实际金额（**分**） |
| `products_num` | 产品数量 |
| `additional` | 订单附加信息 |
| `remarks` | 订单备注 |
| `created_time` | 订单创建时间（毫秒时间戳） |
| `signing_date` | 签约日期 |
| `update_time` | 更新时间 |
| `education_stage` | 教育阶段 |
| `app_time` | 申请时间 |
| `contract_end` | 合同结束时间 |
| `colleges_num` | 申请学校数量 |
| `pro_num` | 专业数量 |
| `order_contract_template_id` | 合同模板ID（null=无合同模板） |
| `study_abroad` | 是否留学 |
| `supplemental_agreement` | 补充协议内容 |
| `ht_zhuanye` | 合同专业（profession） |
| `ht_clshijian` | 入学时间（entrance_time） |
| `ht_cjsjshijian` | 出成绩时间（score_up_time） |
| `edu_student_type_id` | 学员类型ID |
| `edu_student_type_project_id` | 报读项目ID |
| `main_order_student_id` | 主订单ID（null=主订单；有值=辅订单） |
| `crm_keyword` | 最新关键字 |
| `extra_fields` | 扩展字段（JSON 字符串） |

### 关联别名字段（JOIN 后输出）

| 输出字段 | 来源 |
|---------|------|
| `student_name` | edu_student.name |
| `student_code` | edu_student.student_code（→ `edu_student_crm_id` 新CRM关联字段） |
| `admin_user_name` | admin_user.user |
| `order_entry_name` | order_entry.name（项目名称） |
| `goods_name` | edu_goods.name（产品名称） |
| `edu_campus_name` | edu_campus.name |
| `type_name` | order_type.name（订单类型） |
| `pattern_name` | order_pattern.name（费用类型） |
| `department_name` | `CONCAT(n1.name, '-', n.name)` 一级-二级部门 |
| `edu_goods_section_name` | edu_goods_section.name（产品分类） |
| `edu_student_crm_id_old` | edu_student_party.crm_id（旧CRM关联，需 `b.id = pp.student_id`） |
| `edu_student_status_name` | edu_student_status.name |
| `edu_goods_year_name` | edu_goods_year.name（价格体系） |
| `admin_pay_order_id` | admin_pay_order_student.admin_pay_order_id |
| `order_contract_id` | order_contract.id |

## 三、子查询表（订单关联数据）

### 3.1 CRM 线索（新数据，2025-05-31 之后）

来源：`customer_info` + `customer_clue_info` + `crm_channels`

| 表 | 别名 | 关联 |
|----|------|------|
| `customer_info` | a | 主表，`a.code = edu_student.student_code` |
| `customer_clue_info` | b | `a.code = b.customer_code AND b.deleted = 0` |
| `crm_channels` | c | 一级渠道：`b.level1_channel_code = c.channel_code AND c.channel_type=1` |
| `crm_channels` | c2 | 二级渠道：`b.level2_channel_code = c2.channel_code AND c2.channel_type=2` |
| `crm_channels` | c3 | 三级渠道：`b.level3_channel_code = c3.channel_code AND c3.channel_type=3` |
| `crm_channels` | c4 | 四级渠道：`b.level4_channel_code = c4.channel_code AND c4.channel_type=4` |
| `admin_user_channel` | auc | 自定义渠道：`b.level2_channel_code = auc.id` |
| `admin_user` | d | 录入人：`a.create_by = d.id` |
| `admin_user` | d1 | 最初录入人：`b.first_create_by = d1.id` |

输出字段：`lx_id`（=code）、`edu_crm_operator`（录入人）、`origin_operator`（最初录入人）、`edu_crm_source`（一级渠道）、`edu_crm_utm_source`（二级渠道）、`utm_campaign`（keyword）、`utm_medium`、`utm_content`、`utm_term`、`special_channel`、`introduce_user`（转介绍人）、`customer_source`（枚举）、`customer_source_name`、`channel_type_name`、`crm_create_time`

**特殊逻辑：**
- `special_channel = 7` 时：`edu_crm_utm_source` 取 `auc.name`（自定义渠道名），`utm_medium`/`utm_content` 为空串；`channel_type_name` 按 `auc.type`：1=机构渠道 2=个人渠道
- `customer_source` 映射表：1电话呼入 2新媒体运营 3招生平台 4渠道精推 5转介绍 6上门咨询 7网络推广 8微信咨询 9渠道数据 10联考 11准确信息 12批量数据 13渠道精推

### 3.2 CRM 线索（旧数据，2025-05-31 之前）

来源：`clue` 表
- 条件：`lx_id IN (...) AND type = 1 AND (crm_is = 1 OR crm_is = 2)`
- 字段：`lx_id, edu_crm_operator(=operator), edu_crm_source(=source), edu_crm_utm_source(=utm_source), utm_campaign, utm_medium, utm_content, utm_term`
- 关联：`clue.lx_id = edu_student_party.crm_id`

### 3.3 订单驳回记录

来源：`order_student_reject`
- 字段：`order_student_id, remarks`
- 只取**最新一条**：`ORDER BY created_time DESC LIMIT 0,1`

### 3.4 订单审批追踪记录

来源：`order_approval_order_student_log` a + `admin_user` b
- 关联：`a.admin_user_id = b.id AND a.del = 0`
- 字段：`id, order_student_id, level(审批级别), admin_user_id, created_time, remarks, admin_user_name`
- 一单可有多条（多级审批）

### 3.5 退款审批信息

来源：`order_student_refund`
- 条件：`order_student_id IN (...) AND del = 0`
- 排序：`ORDER BY created_time DESC`
- 字段：`id, order_student_id, type, status, upgrade_amount, refund_amount, launch_admin_user_id`

### 3.6 合同签署记录

来源：`order_contract`
- 条件：`order_student_id IN (...) AND del = 0`
- 字段：`id, order_student_id, contract_url`

### 3.7 课时-科目关联

来源：`order_student_class` a 左连科目链：
| 表 | 关联 |
|----|------|
| `edu_course_exam_subject_name` b | `a.edu_course_exam_subject_name_id = b.id`（科目名称） |
| `edu_course_exam_subject` c | `b.subject_id = c.id`（科目） |
| `edu_course_exam` d | `c.exam_id = d.id`（考试） |
| `edu_course` e | `d.course_id = e.id`（课程） |
| `edu_course_exam_subject_name_price_list` h | `g.price_id = h.price_id AND b.id = h.subject_name_id`（标准单价） |

字段：`order_student_id, class_hour(课时), subject_name_id, subject_name_name, subject_id, subject_name, exam_id, exam_name, course_id, course_name, amount(单价), total_amount(=class_hour*amount)`

### 3.8 学员类型 / 报读项目

- `edu_student_type`（学员类型，全表 del=0）：`id, name`
- `edu_student_type_project`（报读项目，全表 del=0）：`id, name`

### 3.9 产品合同模板

来源：`edu_goods`：`id, order_contract_template_id`（用于判断"三方确认" isThreeConfirm）

### 3.10 支付单

来源：`admin_pay_order_student`
- 有效支付单：join `admin_pay_order b ON a.admin_pay_order_id = b.id`，`b.status = 1 AND b.del = 0` → 用于 `refund_btn_status`
- 全量支付单：直接查 `admin_pay_order_student` → 用于 `pay_order_id`

### 3.11 主/辅订单

- `findAssistMainOrderData`：`order_student WHERE id IN (main_order_ids)` → 主订单信息
- `findOrderAssistOrderList`：`order_student WHERE del = 0 AND main_order_student_id IN (order_ids)` → 辅订单列表

## 四、枚举字典

### 订单审批状态 `status`（order_student.status）
| 值 | 含义 |
|----|------|
| 1 | 待审批 |
| 2 | 已驳回 |
| 3 | 已通过 |
| 4 | 待退费（`checkStatusForString(tag=true)` 显示"已退款"） |
| 5 | 退款中 |

### 订单类型 `type_id`（order_type）
| 值 | 含义 |
|----|------|
| 1 | 新签 |
| 2 | 复购 |
| 3 | 续费 |
| 4 | 退费 |
| 5 | 其他 |
| 6 | 佣金收入 |

### 订单模式 `pattern_id`（order_pattern）
| 值 | 含义 |
|----|------|
| 1 | 课程 |
| 2 | 学杂费 |
| 3 | 其他 |

### 订单生效状态 `valid`（order_student.valid）
| 值 | 含义 |
|----|------|
| 0 | 未生效 |
| 1 | 已生效 |
| 2 | 已耗尽 |
| 3 | 转移中 |

### 合同签署状态（order_contract）
| 条件 | 含义 |
|------|------|
| `order_contract_template_id IS NULL` | 无合同 |
| `order_contract_template_id NOT NULL AND order_contract.id IS NULL` | 未签署 |
| `order_contract.id NOT NULL AND contract_url NOT NULL` | 已签署 |

### 退款审批状态（order_student_refund.status）
| 值 | 含义 |
|----|------|
| 1 | 退款中/待审批 |
| 2 | 已通过/已退款 |
| 3 | 已驳回 |

### CRM 线索状态（customer_clue_info / clue.crm_is）
| 值 | 含义 |
|----|------|
| 1 | 新线索 |
| 2 | 有效重复线索 |

### CRM 线索类型（clue.type）
| 值 | 含义 |
|----|------|
| 0 | 学通-市场线索 |
| 1 | 学通-销售线索 |
| 2 | 学通-网站表单 |
| 3 | 学通-手机验证表单 |
| 4 | 科桥-市场线索 |
| 5 | 科桥-销售线索 |
| 6 | 52择校-网站表单 |

## 五、特殊业务逻辑（写 SQL 时必须遵守）

1. **软删除**：所有表查询必须加 `del = 0`
2. **新老数据分界**：`NEWCRMONLINETIME = 1748707200000`（2025-05-31）
   - `is_old_flag=1`（旧数据）：`order_student.created_time < 1748707200000`
   - `is_old_flag=0`（新数据）：`order_student.created_time >= 1748707200000`
   - 旧数据查 `clue` 表 CRM；新数据查 `customer_info/customer_clue_info` 表 CRM
3. **默认排序**：`a.del ASC, a.created_time DESC, a.update_time DESC`
4. **分区过滤**：订单属于哪个事业部看 `edu_goods.admin_division`（学通=1）
5. **去重**：主查询用 `SELECT DISTINCT`（因为 join 了 apos/oc/pp 会产生重复行）；**count 必须用 `COUNT(DISTINCT a.id)`**
6. **合同签署状态过滤**：
   - 已签署：`oc.id IS NOT NULL AND a.order_contract_template_id IS NOT NULL AND oc.del = 0`
   - 未签署：`(oc.id IS NULL OR a.order_contract_template_id IS NULL)`
7. **退款发起时间过滤**：子查询 `a.id IN (SELECT order_student_id FROM order_student_refund WHERE created_time BETWEEN ... AND del = 0 AND status = 1)`
8. **产品名称模糊**：`edu_goods.name LIKE '%xxx%'`
9. **金额单位**：所有金额字段存"分"，展示需 ÷100；折扣系数 ÷100000
10. **时间字段**：`created_time`/`signing_date` 为毫秒时间戳，按天过滤需转当日开始/结束毫秒
11. **主辅订单**：`main_order_student_id IS NULL` = 主订单；有值 = 辅订单（指向主订单ID）
12. **三方确认**（isThreeConfirm）：产品 `edu_goods.order_contract_template_id` 存在 且 订单 `order_contract_template_id` 为空 → true

## 六、导出字段中文映射（formatOrderDataFields）

| 输出字段 | 中文名 | 来源/加工 |
|---------|--------|----------|
| `id` | 订单ID | order_student.id |
| `title` | 合同标题 | order_student.title |
| `pay_order_id` | 支付单ID | admin_pay_order_student |
| `order_number` | 合同编号 | order_student.order_number |
| `student_id` | 学员ID | order_student.student_id |
| `student_name` | 学员姓名 | edu_student.name |
| `edu_student_type_name` | 学员类型 | edu_student_type.name |
| `edu_student_type_project_name` | 课程体系 | edu_student_type_project.name |
| `created_time` | 订单创建日期 | order_student.created_time 格式化 |
| `status` | 订单审批状态 | 枚举中文（status=4 显示"已退款"） |
| `checkLogList` | 订单审批人/审批时间 | check_log_list 拼接 |
| `valid` | 订单是否生效 | 枚举中文 |
| `order_entry_name` | 项目名称 | order_entry.name |
| `edu_goods_section_name` | 产品分类 | edu_goods_section.name |
| `goods_name` | 产品名称 | edu_goods.name |
| `pattern_name` | 费用类型 | order_pattern.name |
| `order_student_class_total_hours` | 总课时 | classList 课时求和 |
| `type_name` | 订单类型 | order_type.name |
| `total_amount` | 订单总金额 | ÷100 元 |
| `discount` | 订单折扣系数 | ÷100000 5位小数 |
| `transaction_amount` | 订单实际金额 | ÷100 元 |
| `received_amount_total` | 回款总金额 | 排课统计 ÷100 元 |
| `arrearage_amount_total` | 欠费排课金额 | 排课统计 ÷100 元 |
| `received_count` | 回款总数 | 排课统计 |
| `edu_campus_name` | 订单所属校区 | edu_campus.name |
| `consume_withhold_total` | 预扣总金额 | 排课统计 ÷100 元 |
| `consume_truthfull_total` | 课耗实扣总金额 | 排课统计 ÷100 元 |
| `order_residue_amount` | 订单剩余金额 | 排课统计 ÷100 元 |
| `refund_total` | 退款金额 | 排课统计 ÷100 元 |
| `order_student_refund_status` | 退款审批状态 | order_student_refund.status 枚举 |
| `edu_crm_operator` | 销售线索录入人 | CRM 表 |
| `edu_crm_source` | 线索来源 | CRM 一级渠道 |
| `edu_crm_utm_source` | utm_source | CRM 二级渠道 |
| `utm_campaign` | utm_campaign | CRM keyword |
| `utm_medium` | utm_medium | CRM 三级渠道 |
| `utm_content` | utm_content | CRM 四级渠道 |
| `utm_term` | utm_term | CRM |
| `admin_user_name` | 创建人 | admin_user.user |
| `order_student_reject` | 驳回原因 | order_student_reject.remarks |
| `remarks` | 备注 | order_student.remarks |
| `order_contract_status` | 合同签署状态 | 模板/合同判断，中文"已签署/未签署/-" |
| `introduce_user` | 转介绍人 | CRM |
| `customer_source_name` | 客户来源 | CRM 枚举中文 |
| `channel_type_name` | 渠道类型 | CRM（仅自定义渠道） |
| `crm_keyword` | 最新关键字 | order_student.crm_keyword |

## 七、统计接口（findOrderStatictis）

来源：排课系统 `courseAmountService.findOrderStudentStatistics(order_student_ids)`
按订单聚合的统计字段（全部为**分**）：`arrearage_amount_total, arrearage_residue_amount, checking_amount_total, consume_add_count, consume_add_total, consume_truthfull_count, consume_truthfull_total, consume_withhold_count, consume_withhold_total, finish_course_residue_total, no_received_amount_total, order_residue_amount, pass_and_not_arrearage_amount_total, received_all_type_amount_total, received_amount_total, received_count, refund_amount, refund_total, refund_type, residue_total, upgrade_amount, amount_total`

---

## 八、典型 SQL 骨架

```sql
SELECT DISTINCT
  a.id, a.title, a.order_number, a.status, a.valid, a.created_time, a.signing_date,
  a.total_amount, a.transaction_amount, a.discount,
  b.name AS student_name,
  c.user AS admin_user_name,
  d.name AS order_entry_name,
  e.name AS goods_name,
  f.name AS edu_campus_name,
  h.name AS type_name,
  m.name AS pattern_name,
  egs.name AS edu_goods_section_name,
  b.student_code AS edu_student_crm_id,
  a.crm_keyword
FROM order_student a
LEFT JOIN edu_student b ON a.student_id = b.id
LEFT JOIN admin_user c ON a.admin_user_id = c.id
LEFT JOIN order_entry d ON a.order_entry_id = d.id
LEFT JOIN edu_goods e ON a.goods_id = e.id
LEFT JOIN edu_campus f ON a.edu_campus_id = f.id
LEFT JOIN order_type h ON a.type_id = h.id
LEFT JOIN order_pattern m ON a.pattern_id = m.id
LEFT JOIN edu_goods_section egs ON e.edu_goods_section_id = egs.id
WHERE a.del = 0
  AND e.admin_division = 1            -- 学通事业部（导出接口固定）
  AND a.created_time >= 1748707200000  -- 新数据（可选）
ORDER BY a.created_time DESC, a.update_time DESC
LIMIT 0, 100;
```
