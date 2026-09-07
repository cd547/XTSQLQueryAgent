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

## 七.5、金额字段计算逻辑

> 来源：`services/courseAmount.js → calculateReceivedTotal()`、`lib/utils.js → caculateTotalAmountDiscountAndTransactionAmount()`
> **所有金额字段存储单位为"分"**，以下公式中涉及的均为分；折扣系数单独存储（÷100000）

### 1. 订单金额关系（新增/校验订单时）

```
校验公式：transaction_amount === Math.round(total_amount × discount)
不保留小数时：transaction_amount === Math.floor(Math.round(total_amount × discount) / 100) × 100
```
- `total_amount`：订单总金额（产品原价 × 数量）
- `discount`：折扣系数（如 0.9 存为 90000）
- `transaction_amount`：订单实际成交金额

### 2. 课耗金额（consume_*）

| 字段 | 计算逻辑 |
|------|---------|
| `consume_truthfull_total` | 实际课耗金额 = **实扣总课耗 − 增款总课耗** |
| `consume_truthfull_count` | 实际课耗笔数 = **实扣总笔数 + 增款笔数** |
| `consume_withhold_total` | 预扣课耗总金额（排课预占，未实际扣费） |
| `consume_add_total` | 增款总金额（手动补充课时） |
| `amount_total` | 总课耗金额 = `consume_truthfull_total + consume_withhold_total` |

### 3. 未回款金额（no_received_amount_total）

```
IF received_count = 0（从未回款）:
    no_received = transaction_amount
ELSE IF valid != 0（订单已生效）:
    no_received = arrearage_amount_total + checking_amount_total
    （未通过的回款 + 欠费回款 = 还没实际到账的钱）
ELSE（订单未生效）:
    no_received = transaction_amount − pass_and_not_arrearage_amount_total
```

### 4. 排课可用金额（residue_total）

**前提条件（三个同时满足才计算，否则为 0）：**
```
pattern_id = 1（课程类型）AND status = 3（已通过）AND valid = 1（已生效）
```
```
residue_total = received_amount_total − (consume_truthfull_total + consume_withhold_total)
```
（未通过/已通过/欠费的回款都能用来排课，扣掉已扣和预扣的课耗）

### 5. 结课可用金额（finish_course_residue_total）

**前提条件同 residue_total：**
```
finish_course_residue_total = passAndChecking_and_not_arrearage_amount_total − consume_truthfull_total
```
（已通过且非欠费的回款总额 − 实际课耗）

### 6. 欠费余额（arrearage_residue_amount）

```
IF residue_total > arrearage_amount_total:
    arrearage_residue_amount = arrearage_amount_total
ELSE:
    arrearage_residue_amount = residue_total
（取两者较小值）
```

### 7. 退款金额（refund_total）

**仅 status = 4（已退款）时计算，否则为 0：**
```
IF refund_type = 退费:  refund_total = refund_amount
IF refund_type = 转让:  refund_total = upgrade_amount
```

### 8. 订单剩余金额（order_residue_amount）与净收款

```
net_received_amount_total（净收款）= received_amount_total − arrearage_amount_total − refund_total
order_residue_amount = net_received_amount_total − consume_truthfull_total
```
**退款订单清零规则（2025-12-30 余额统计口径）：**
```
IF status = 4（已退款）:
    IF 退款时间(refund_refund_time) < 截止日期(expiration_date):
        residue_total = 0
        order_residue_amount = 0
    ELSE:
        保留原值（退款日期在截止日之后，截止日前仍可用）
    arrearage_residue_amount = 0
    finish_course_residue_total = 0
```

### 9. 汇总聚合（reduceAllOrderStatisticsAmount）

统计 `statistics` 汇总对象 = 所有订单对应字段**直接求和**（`reduceAmount = SUM`）：
`arrearage_amount_total, checking_amount_total, consume_add_count, consume_add_total, consume_truthfull_count, consume_truthfull_total, consume_withhold_count, consume_withhold_total, finish_course_residue_total, no_received_amount_total, pass_and_not_arrearage_amount_total, received_amount_total, received_count, refund_total, order_residue_amount, arrearage_residue_amount, residue_total, transaction_amount_total, received_all_type_amount_total`

### 10. 字段含义速查

| 字段 | 含义 |
|------|------|
| `received_amount_total` | 已回款总金额（所有状态回款之和，可排课） |
| `pass_and_not_arrearage_amount_total` | 已通过且不是欠费的回款金额 |
| `checking_amount_total` | 未通过（审核中）的回款金额 |
| `arrearage_amount_total` | 欠费排课回款金额 |
| `passAndChecking_and_not_arrearage_amount_total` | 已通过+未通过 且不是欠费的回款金额（结课余额用） |
| `received_all_type_amount_total` | 所有类型回款总额 |
| `refund_amount` | 退款金额（退费类） |
| `upgrade_amount` | 转让/升级金额（订单转换） |
| `net_recevied_amount_total` | 净收款 = 回款 − 欠费 − 退款 |
| `transaction_amount_total` | 订单实际金额合计 |

---

## 七.6、订单审批人与审批时间的数据来源

**来源表：`order_approval_order_student_log`**（订单审核记录表，join `admin_user` 取姓名）

```sql
-- services/order.js findOrderStudentAssociations 中的 aLogSql
SELECT
  a.id,
  a.order_student_id,
  a.level,              -- 审批级别（1级/2级/3级）
  a.admin_user_id,
  a.created_time,       -- 订单审批时间
  a.remarks,            -- 审批意见
  b.user as admin_user_name   -- 订单审批人
FROM order_approval_order_student_log a
LEFT JOIN admin_user b ON a.admin_user_id = b.id
WHERE a.order_student_id IN (...) AND a.del = 0
```

| 数据 | 表.字段 |
|------|--------|
| 订单审批人 | `order_approval_order_student_log.admin_user_id` → `admin_user.user` |
| 订单审批时间 | `order_approval_order_student_log.created_time`（毫秒时间戳） |
| 审批级别 | `order_approval_order_student_log.level` |
| 审批意见 | `order_approval_order_student_log.remarks` |

**一个订单可能有多条审批记录**（多级审批），导出时拼接为 `"1级审批人 张三 2026-08-01"` 换行格式（`check_log_list` → `checkLogList` 字段）。

---

## 七.7、订单剩余金额（order_residue_amount）计算方式速查

来源：`services/courseAmount.js → calculateReceivedTotal()`（第 1624-1640 行）

```
净收款 = received_amount_total(已回款总金额) − arrearage_amount_total(欠费排课) − refund_total(退款金额)
订单剩余金额 = 净收款 − consume_truthfull_total(实际课耗)
```

| 步骤 | 公式 |
|------|------|
| 已回款总金额 | `received_amount_total`（所有状态回款之和，单位分） |
| 净收款 | `received_amount_total − arrearage_amount_total − refund_total` |
| **订单剩余金额** | **净收款 − `consume_truthfull_total`**（实扣课耗，已剔除增款） |
| 退款金额 refund_total | 仅 `status=4`（已退款）时有值：退费→`refund_amount`，转让→`upgrade_amount` |

**退款订单清零规则（2025-12-30 余额统计口径）：**

```
IF status = 4（已退款）:
    IF refund_refund_time（退款时间）< expiration_date（账目截止日期）:
        order_residue_amount = 0    -- 截止日前已退完，剩余清零
    ELSE:
        保留原值                        -- 退款发生在截止日之后，截止日前仍可用
```

**注意区分**：`order_residue_amount`（订单剩余金额，净收款−实扣课耗）≠ `residue_total`（排课可用金额 = 回款 − 实扣 − 预扣，仅课程类型+已通过+已生效订单才有值）。两者在退款订单上都会按退款日期清零。

---

## 八、常用 SQL 模板

> 以下模板均省略公共 JOIN 段（用 `<公共JOIN>` 占位），实际使用请补全。公共 JOIN：
> `LEFT JOIN edu_student b ON a.student_id = b.id LEFT JOIN admin_user c ON a.admin_user_id = c.id LEFT JOIN order_entry d ON a.order_entry_id = d.id LEFT JOIN edu_goods e ON a.goods_id = e.id LEFT JOIN edu_campus f ON a.edu_campus_id = f.id LEFT JOIN order_type h ON a.type_id = h.id LEFT JOIN order_pattern m ON a.pattern_id = m.id LEFT JOIN edu_goods_section egs ON e.edu_goods_section_id = egs.id`

### 模板 1：基础列表查询（含分页）

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
<公共JOIN>
WHERE a.del = 0
  AND e.admin_division = 1            -- 学通事业部（导出接口固定）
ORDER BY a.created_time DESC, a.update_time DESC
LIMIT 0, 100;
```

### 模板 2：COUNT 查询（去重统计）

```sql
SELECT COUNT(DISTINCT a.id) AS count
FROM order_student a
LEFT JOIN edu_student b ON a.student_id = b.id
LEFT JOIN edu_goods e ON a.goods_id = e.id
LEFT JOIN admin_pay_order_student apos ON a.id = apos.order_student_id
LEFT JOIN order_contract oc ON a.id = oc.order_student_id
WHERE a.del = 0 AND e.admin_division = 1;
```

### 模板 3：按审批状态过滤

```sql
-- 待审批订单
WHERE a.del = 0 AND a.status = 1
-- 已驳回订单
WHERE a.del = 0 AND a.status = 2
-- 已通过订单
WHERE a.del = 0 AND a.status = 3
-- 待退费（前端显示"待退费"，导出显示"已退款"）
WHERE a.del = 0 AND a.status = 4
-- 退款中
WHERE a.del = 0 AND a.status = 5
```

### 模板 4：按创建日期/签约日期范围过滤

```sql
-- 创建日期 2026-07-01 ~ 2026-07-31（毫秒时间戳）
WHERE a.del = 0
  AND a.created_time BETWEEN 1780243200000 AND 1782835200000

-- 签约日期同理，字段换 a.signing_date
WHERE a.del = 0
  AND a.signing_date BETWEEN 1780243200000 AND 1782835200000
```

### 模板 5：新老数据过滤

```sql
-- 新数据（2025-05-31 之后）：查 customer_info/customer_clue_info CRM
WHERE a.del = 0 AND a.created_time >= 1748707200000

-- 旧数据（2025-05-31 之前）：查 clue 表 CRM
WHERE a.del = 0 AND a.created_time < 1748707200000
```

### 模板 6：关联 CRM 线索信息（新数据）

```sql
SELECT DISTINCT
  a.id, a.title,
  b.name AS student_name,
  b.student_code AS edu_student_crm_id,
  d.user AS edu_crm_operator,              -- 销售线索录入人
  d1.user AS origin_operator,              -- 最初录入人
  c.channel_name AS edu_crm_source,        -- 一级渠道
  CASE b2.special_channel WHEN 7 THEN auc.name ELSE c2.channel_name END AS edu_crm_utm_source,
  b2.keyword AS utm_campaign,
  b2.utm_term,
  b2.introduce_user,                       -- 转介绍人
  CASE b2.customer_source
    WHEN 1 THEN '电话呼入' WHEN 2 THEN '新媒体运营' WHEN 3 THEN '招生平台'
    WHEN 4 THEN '渠道精推' WHEN 5 THEN '转介绍' WHEN 6 THEN '上门咨询'
    WHEN 7 THEN '网络推广' WHEN 8 THEN '微信咨询' WHEN 9 THEN '渠道数据'
    WHEN 10 THEN '联考' WHEN 11 THEN '准确信息' WHEN 12 THEN '批量数据'
    WHEN 13 THEN '渠道精推' ELSE ''
  END AS customer_source_name
FROM order_student a
<公共JOIN>
LEFT JOIN customer_info ci ON ci.code = b.student_code
LEFT JOIN customer_clue_info b2 ON ci.code = b2.customer_code AND b2.deleted = 0
LEFT JOIN crm_channels c ON b2.level1_channel_code = c.channel_code AND c.channel_type = 1
LEFT JOIN crm_channels c2 ON b2.level2_channel_code = c2.channel_code AND c2.channel_type = 2
LEFT JOIN admin_user_channel auc ON b2.level2_channel_code = auc.id
LEFT JOIN admin_user d ON ci.create_by = d.id
LEFT JOIN admin_user d1 ON b2.first_create_by = d1.id
WHERE a.del = 0 AND a.created_time >= 1748707200000;
```

### 模板 7：关联 CRM 线索信息（旧数据）

```sql
SELECT DISTINCT
  a.id, a.title,
  cl.lx_id AS edu_student_crm_id_old,
  cl.operator AS edu_crm_operator,
  cl.source AS edu_crm_source,
  cl.utm_source AS edu_crm_utm_source,
  cl.utm_campaign, cl.utm_medium, cl.utm_content, cl.utm_term
FROM order_student a
<公共JOIN>
LEFT JOIN edu_student_party pp ON b.id = pp.student_id
LEFT JOIN clue cl ON cl.lx_id = pp.crm_id
  AND cl.type = 1 AND (cl.crm_is = 1 OR cl.crm_is = 2)
WHERE a.del = 0 AND a.created_time < 1748707200000;
```

### 模板 8：关联审批记录 + 驳回原因

```sql
SELECT DISTINCT
  a.id, a.title, a.status,
  al.level, al.created_time AS check_time, al.remarks AS check_remarks,
  u.user AS check_admin_user_name,
  r.remarks AS order_student_reject           -- 最新驳回原因
FROM order_student a
<公共JOIN>
LEFT JOIN order_approval_order_student_log al
  ON al.order_student_id = a.id AND al.del = 0
LEFT JOIN admin_user u ON al.admin_user_id = u.id
LEFT JOIN order_student_reject r
  ON r.order_student_id = a.id
WHERE a.del = 0
-- 最新驳回记录：ORDER BY created_time DESC LIMIT 0,1 需要在子查询中取
```

### 模板 9：关联退款信息

```sql
SELECT DISTINCT
  a.id, a.title,
  rf.id AS refund_id,
  rf.type AS refund_type,
  rf.status AS refund_status,                 -- 1待审批 2已通过 3驳回
  rf.refund_amount,
  rf.upgrade_amount,
  rf.launch_admin_user_id
FROM order_student a
<公共JOIN>
LEFT JOIN order_student_refund rf
  ON rf.order_student_id = a.id AND rf.del = 0
WHERE a.del = 0;
```

### 模板 10：关联合同签署状态

```sql
SELECT DISTINCT
  a.id, a.title, a.order_contract_template_id,
  oc.id AS order_contract_id,
  oc.contract_url,
  CASE
    WHEN a.order_contract_template_id IS NULL THEN '无合同'
    WHEN oc.id IS NULL THEN '未签署'
    WHEN oc.contract_url IS NOT NULL THEN '已签署'
    ELSE '未签署'
  END AS contract_status
FROM order_student a
<公共JOIN>
LEFT JOIN order_contract oc ON a.id = oc.order_student_id AND oc.del = 0
WHERE a.del = 0;
```

### 模板 11：关联课时-科目（总课时统计）

```sql
SELECT
  a.id, a.title,
  COUNT(DISTINCT oc.id) AS class_count,
  COALESCE(SUM(oc.class_hour), 0) AS order_student_class_total_hours,
  SUM(oc.class_hour * h.amount) AS class_total_amount
FROM order_student a
<公共JOIN>
LEFT JOIN order_student_class oc ON oc.order_student_id = a.id
LEFT JOIN edu_course_exam_subject_name b2 ON oc.edu_course_exam_subject_name_id = b2.id
LEFT JOIN edu_course_exam_subject c2 ON b2.subject_id = c2.id
LEFT JOIN edu_course_exam d2 ON c2.exam_id = d2.id
LEFT JOIN edu_course e2 ON d2.course_id = e2.id
LEFT JOIN edu_goods_subject_name_price_list h ON e.price_id = h.price_id AND b2.id = h.subject_name_id
WHERE a.del = 0
GROUP BY a.id;
```

### 模板 12：关联支付单

```sql
SELECT DISTINCT
  a.id, a.title,
  apos.admin_pay_order_id
FROM order_student a
<公共JOIN>
LEFT JOIN admin_pay_order_student apos ON a.id = apos.order_student_id
LEFT JOIN admin_pay_order apo ON apos.admin_pay_order_id = apo.id
  AND apo.status = 1 AND apo.del = 0        -- 只有有效支付单才显示退款按钮
WHERE a.del = 0;
```

### 模板 13：主/辅订单

```sql
-- 主订单及其辅订单
SELECT
  a.id AS main_order_id, a.title AS main_title,
  sub.id AS assist_order_id, sub.title AS assist_title,
  sub.status, sub.valid
FROM order_student a
LEFT JOIN order_student sub
  ON sub.main_order_student_id = a.id AND sub.del = 0
WHERE a.del = 0 AND a.main_order_student_id IS NULL;

-- 查某订单的主订单
SELECT a.* FROM order_student a
WHERE a.del = 0 AND a.id = <主订单ID>;
```

### 模板 14：订单创建人及其部门

```sql
SELECT DISTINCT
  a.id, a.title,
  c.user AS admin_user_name,
  CONCAT(n1.name, '-', n.name) AS department_name,   -- 一级-二级部门
  c.parent_id
FROM order_student a
<公共JOIN>
LEFT JOIN admin_department_children n ON c.department_id = n.id
LEFT JOIN admin_department n1 ON n.department_id = n1.id
WHERE a.del = 0;
```

### 模板 15：按合同签署状态过滤

```sql
-- 已签署
WHERE a.del = 0
  AND oc.id IS NOT NULL AND a.order_contract_template_id IS NOT NULL AND oc.del = 0
-- 未签署
WHERE a.del = 0 AND (oc.id IS NULL OR a.order_contract_template_id IS NULL)
```

### 模板 16：退款发起日期范围过滤

```sql
WHERE a.del = 0
  AND a.id IN (
    SELECT order_student_id FROM order_student_refund
    WHERE created_time BETWEEN 1780243200000 AND 1782835200000
      AND del = 0 AND status = 1
  );
```

### 模板 17：订单金额统计（回款/课耗/剩余）

```sql
-- 结合排课系统统计（按订单聚合，字段来自 courseAmountService）
SELECT
  a.id, a.title, a.total_amount, a.transaction_amount,
  st.received_amount_total,    -- 已回款总金额（分）
  st.received_count,           -- 回款次数
  st.no_received_amount_total, -- 未回款金额（分）
  st.residue_total,            -- 排课可用金额（分）
  st.order_residue_amount,     -- 订单剩余金额（分）
  st.arrearage_amount_total,   -- 欠费排课金额（分）
  st.consume_truthfull_total,  -- 课耗实扣金额（分）
  st.consume_withhold_total,   -- 预扣金额（分）
  st.refund_total              -- 退款金额（分）
FROM order_student a
<公共JOIN>
LEFT JOIN <排课统计表> st ON st.order_student_id = a.id
WHERE a.del = 0;
```

### 模板 18：完整导出等价查询（参照 formatOrderDataFields）

```sql
SELECT DISTINCT
  a.id, a.title, a.order_number, a.status, a.valid, a.created_time, a.signing_date,
  a.total_amount, a.transaction_amount, a.discount, a.remarks, a.crm_keyword,
  a.order_contract_template_id,
  b.name AS student_name, b.student_id, b.student_code AS student_code_new,
  c.user AS admin_user_name,
  d.name AS order_entry_name,
  e.name AS goods_name,
  f.name AS edu_campus_name,
  h.name AS type_name,
  m.name AS pattern_name,
  egs.name AS edu_goods_section_name,
  ess.name AS edu_student_status_name,
  oc.id AS order_contract_id,
  oc.contract_url,
  apos.admin_pay_order_id
FROM order_student a
<公共JOIN>
LEFT JOIN edu_student_status ess ON b.edu_student_status_id = ess.id
LEFT JOIN admin_pay_order_student apos ON a.id = apos.order_student_id
LEFT JOIN order_contract oc ON a.id = oc.order_student_id AND oc.del = 0
WHERE a.del = 0 AND e.admin_division = 1
ORDER BY a.created_time DESC, a.update_time DESC;
```
