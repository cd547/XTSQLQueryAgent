# findInternalReceivedList（内部回款列表）SQL 数据模型分析

> 位置：`controllers/received.js` L2055 `ReceivedController.findInternalReceivedList(query, isExport)`
> 用途：内部回款列表查询/导出，主查询 + 14 个关联子查询，内存 Map 组装结果。

---

## 一、方法执行流程

```
findInternalReceivedList(query, isExport)
 ├── 1. findReceivedListV2(projections, pageO, querys)          主查询（分页）
 ├── 2. packageReceivedTypeByIdList(data)                       退款回款类型补全
 ├── 3. Promise.all 并行：
 │     ├── findAdminUserByIds(collection_admin_user_ids)        收款人名称
 │     ├── findAdminUserDepartmentByIds(admin_user_ids)         创建人名称+部门
 │     ├── findAdminUserByIds(order_student_admin_user_ids)     订单创建人名称
 │     ├── findOrderStudentReceivedRejectByReceivedIds          驳回原因
 │     ├── findCollectionDepartmentByIds                        部门全名
 │     └── findOrderInit(studentIds)                            订单初始创建人
 ├── 4. Promise.all 并行：
 │     ├── findAllReceivedApprovalLogList(received_ids)         审核追踪记录
 │     ├── findCrmDataByCrmIds / V2(crmids)                     CRM 线索信息（老/新）
 │     ├── findOrderStudentStatistics                           订单回款/课耗统计金额
 │     ├── findReceivedAnnexList(received_ids)                  凭证附件
 │     ├── findStudentTypeAndProjects(eduStudentIds)            学员类型/项目
 │     ├── findGoodsYearDataByIds(yearIds)                      产品年份名称
 │     └── findAdminPayOrders(fOrderStudentIds)                 支付单号
 ├── 5. findOriginOpereator(stuData)（老数据） 或 findLastKeyWord(stuData)（新数据）
 ├── 6. 内存 Map 组装 list
 └── 7. findReceivedListCountV2(querys)                         总数（导出超限校验）
```

---

## 二、主查询 findReceivedListV2（services/received.js L268）

### 2.1 FROM 与 JOIN（表关系图）

```
order_student_received a   回款计划表（主表，别名 a，强制 a.del = 0）
 ├── order_student b                 ON a.order_student_id = b.id       学员订单
 │    ├── edu_student c              ON b.student_id = c.id             学员
 │    │    └── edu_student_party esp ON c.id = esp.student_id AND esp.del = 0  学员CRM关系
 │    ├── order_type d               ON b.type_id = d.id                订单类型
 │    ├── edu_campus e               ON e.id = b.edu_campus_id          校区
 │    ├── order_entry f              ON f.id = b.order_entry_id         项目
 │    ├── order_pattern g            ON g.id = b.pattern_id             订单模式
 │    ├── edu_goods h                ON h.id = b.goods_id               产品
 │    │    ├── edu_goods_section egs ON h.edu_goods_section_id = egs.id 产品板块
 │    │    └── edu_course_exam_subject_name_price ePrice ON h.price_id = ePrice.id 科目标准单价
 │    ├── edu_student_type est_order    ON est_order.id = b.edu_student_type_id          订单学员类型
 │    ├── edu_student_type_project estp_order ON estp_order.id = b.edu_student_type_project_id  订单学员类型项目
 │    ├── admin_pay_order_student apos  ON b.id = apos.order_student_id                  支付单关联
 │    └── order_contract oc             ON a.order_student_id = oc.order_student_id      合同签署记录（一对多！）
 ├── order_type rt                   ON a.type_id = rt.id               回款类型（复用 order_type）
 ├── admin_user adu                  ON a.admin_user_id = adu.id        回款创建人
 │    └── admin_department_children dpc ON adu.department_id = dpc.id   创建人二级部门
 ├── edu_student_type est            ON est.id = a.edu_student_type_id  回款上的学员类型
 └── edu_student_type_project estp   ON estp.id = a.edu_student_type_project_id  回款学员类型项目
```

⚠️ 风险点：
- `oc`（order_contract）按 order_student_id 关联，一个订单多份合同会导致主查询**行膨胀（重复行）**。
- `esp`（edu_student_party）一个学员多条关系时同样可能行膨胀。
- `apos`（admin_pay_order_student）一个订单多个支付单时也可能行膨胀。

### 2.2 输出字段（别名约定）

| 来源 | 字段 |
|---|---|
| a 回款主表 | id, status, order_student_id, account_title, collection_date, admin_user_id, remarks, collection_amount, collection_admin_user_id, created_time, account_title_id, type, transfer_remarks, collection_admin_department_children_id, refund_order_student_received_id, write_source |
| a 别名映射 | edu_student_type_id→received_student_type_id, edu_student_type_project_id→received_student_type_project_id, admin_department_children_id→**receved_admin_user_department_children_id**（收款人二级部门） |
| b 订单 | b.id→order_student_id, student_id, title→order_student_title, order_number, total_amount→order_student_total_amount, transaction_amount→order_student_transaction_amount, additional, signing_date, admin_user_id→order_student_admin_user_id, remarks→order_student_remarks, products_num, created_time, status→order_student_status, edu_campus_id, discount, valid, edu_student_type_id/project_id, order_contract_template_id, **crm_keyword**（最新关键字） |
| c 学员 | name→student_name, student_code→**edu_student_crm_id**（新数据）/→**student_code_new** |
| esp | crm_id→**edu_student_crm_id**（老数据 is_old_flag==1） |
| 维表名称 | d.name→order_student_type_name, e.name→edu_campus_name, f.id/name→order_entry_id/order_entry_name, g.id/name→order_pattern_id/order_pattern_name, h.name→order_goods_name, egs.name→edu_goods_section_name, ePrice.name→edu_goods_price_name, rt.id/name→received_type_id/received_type_name, est.name→received_student_type_name, estp.name→received_student_type_project_name, est_order.name→order_student_edu_student_type_name, estp_order.name→order_student_edu_student_type_project_name, oc.id→order_contract_id |
| h 产品 | edu_goods_section_id, **edu_goods_year_id**（后续查年份名）, edu_goods_discount, admin_division, goods_price |
| apos | admin_pay_order_id |
| dpc | name→receved_admin_user_department_name（源码注释标明"不准！"，勿依赖） |

### 2.3 WHERE 条件映射（setReceivedListQuerysV2，L1225）

基础条件：`a.del = 0`

| query 参数 | SQL 条件 | 说明 |
|---|---|---|
| is_old_flag == 1 | `a.collection_date < 1748707200000` | 老数据分界（见第五节） |
| id | `a.id = ?` | 回款 id |
| order_student_id | `a.order_student_id = ?` | 有此条件时**不分页**查全部 |
| status | `a.status = ?` | 回款审批状态 |
| no_reject | `a.status <> 2` | 排除驳回 |
| order_student_title | `b.title LIKE ?` | 订单标题模糊 |
| collection_date_start + end | `a.collection_date BETWEEN ? AND ?` | 时间戳 |
| student_id | `b.student_id = ?` | |
| allLevelUserIds / admin_user_id | `(a.admin_user_id IN (...) OR a.collection_admin_user_id IN (...))` | 本人及下属创建/收款（本方法不传，教务 findReceivedListNew 使用） |
| account_title | `a.account_title IN (...)` | 数组，逐项 decodeURIComponent |
| edu_campus_id | `b.edu_campus_id = ?` | |
| edu_campus_ids | `b.edu_campus_id IN (...)` | |
| type | `a.type = ?` | 回款/退款 |
| account_type | `=1`→`a.account_title_id = 22`；否则→`(a.account_title_id != 22 OR a.account_title_id IS NULL)` | 欠费排课账户筛选 |
| expiration_date | `a.collection_date BETWEEN ? AND ?` | 账目截止日期（默认自动补当前日期往前 DEFAULT_YEARS=9 年） |
| order_student_pattern_id | `b.pattern_id = ?` | |
| order_student_type_id | `b.type_id = ?` | |
| received_id | `a.id = ?` | |
| admin_division | `h.admin_division = ?` | 事业部 |
| edu_goods_name | `h.name LIKE ?` | 产品名称模糊 |
| collection_admin_user_id | `a.collection_admin_user_id = ?` | 收款人 |
| admin_pay_order_id | `apos.admin_pay_order_id = ?` | |
| order_contract_status == 1 | `oc.id IS NOT NULL AND b.order_contract_template_id IS NOT NULL AND oc.del=0` | 已签署 |
| order_contract_status == 2 | `(oc.id IS NULL or b.order_contract_template_id IS NULL)` | 未签署 |
| student_code_new | `c.student_code = ?` | 线索编号 |

排序：`ORDER BY a.del ASC, a.created_time DESC, a.update_time DESC`（orderByWithFields 默认值）。
分页：`LIMIT offset, limitN`（有 order_student_id 时不分页）。

---

## 三、关联子查询 SQL

### 3.1 findReceivedTypeByIdList（packageReceivedTypeByIdList 内调用）
```sql
SELECT a.id, a.type_id, b.name
FROM order_student_received a LEFT JOIN order_type b ON b.id = a.type_id
WHERE a.id IN (<refund_order_student_received_id 去重列表>)
```
→ 退款回款的原始回款类型名 `refund_order_student_received_type_name`。

### 3.2 AdminuserService.findAdminUserByIds
```sql
SELECT id, user FROM admin_user WHERE id IN (...)
```
→ 收款人名称 collection_admin_user_name、订单创建人名称 order_student_admin_user_name。

### 3.3 AdminuserService.findAdminUserDepartmentByIds
```sql
SELECT a.id, a.user, b.name AS department_name,
       CONCAT(c.name, '-', b.name) AS department_full_name
FROM admin_user a
LEFT JOIN admin_department_children b ON a.department_id = b.id
LEFT JOIN admin_department c ON b.department_id = c.id
WHERE a.id IN (...)
```
→ 回款创建人 admin_user_name + admin_user_department。

### 3.4 findOrderStudentReceivedRejectByReceivedIds
```sql
SELECT order_student_received_id, remarks FROM order_student_received_reject
WHERE order_student_received_id IN (...) ORDER BY created_time DESC
```
→ 仅当 `a.status = 2（驳回）` 时取最新一条 remarks → order_student_received_reject。

### 3.5 findCollectionDepartmentByIds
```sql
SELECT a.id AS department_children_id, a.name AS department_children_name,
       b.id AS department_id, b.name AS department_name,
       CONCAT(b.name, '-', a.name) AS full_department_name
FROM admin_department_children a
LEFT JOIN admin_department b ON b.id = a.department_id
WHERE a.id IN (...)
```
→ collection_admin_department_children_name、receved_admin_user_department_name（部门全名）。

### 3.6 findOrderInit（订单初始创建人）
```sql
SELECT a.student_id, a.admin_user_id, c.user AS admin_user_name, (b.created_time) created_time
FROM order_student a, order_student_received b, admin_user c
WHERE a.id = b.order_student_id AND a.admin_user_id = c.id
  AND a.del = 0 AND b.del = 0 AND b.status = 3
  AND a.student_id IN (...)
GROUP BY a.student_id
```
特殊逻辑：`b.status = 3` 只统计**已通过**的回款；GROUP BY student_id 去重（非严格取最早一条，依赖分组默认行为）。
→ init_order_admin_user_id / init_order_admin_user_name。

### 3.7 checkService.findAllReceivedApprovalLogList
```sql
SELECT a.id, a.order_student_id, a.order_student_received_id, a.level,
       a.admin_user_id, a.remarks, a.created_time, b.user AS admin_user_name
FROM order_approval_order_student_received_log a, admin_user b
WHERE a.order_student_received_id IN (...) AND a.admin_user_id = b.id AND a.del = 0
```
→ check_log_list（按 order_student_received_id 分组数组）。

### 3.8 CRM 线索（老/新数据二选一）

**老数据 findCrmDataByCrmIds**（is_old_flag==1）：
```sql
SELECT lx_id, operator AS edu_crm_operator, source AS edu_crm_source,
       utm_source AS edu_crm_utm_source, utm_campaign, utm_medium,
       utm_content, utm_term, time AS crm_create_time
FROM clue
WHERE lx_id IN ('...') AND type = 1
  AND (crm_is = 1 OR crm_is = 2)
```
- clue.type = 1（学通-销售线索），crm_is ∈ {1:新线索, 2:有效重复线索}
- lx_id 即 esp.crm_id（edu_student_party.crm_id）

**新数据 findCrmDataByCrmIdsV2**：
```sql
SELECT a.code AS lx_id, a.create_by AS edu_crm_operator_id, d.user AS edu_crm_operator,
       d1.user AS origin_operator, c.channel_name AS edu_crm_source,
       CASE b.special_channel WHEN 7 THEN auc.name ELSE c2.channel_name END AS edu_crm_utm_source,
       b.keyword AS utm_campaign,
       CASE b.special_channel WHEN 7 THEN '' ELSE c3.channel_name END AS utm_medium,
       CASE b.special_channel WHEN 7 THEN '' ELSE c4.channel_name END AS utm_content,
       b.utm_term, b.special_channel, b.introduce_user, b.sale_customer_action, b.customer_source,
       CASE b.customer_source
         WHEN 1 THEN '电话呼入'  WHEN 2 THEN '新媒体运营' WHEN 3 THEN '招生平台'
         WHEN 4 THEN '渠道精推'  WHEN 5 THEN '转介绍'    WHEN 6 THEN '上门咨询'
         WHEN 7 THEN '网络推广'  WHEN 8 THEN '微信咨询'  WHEN 9 THEN '渠道数据'
         WHEN 10 THEN '联考'     WHEN 11 THEN '准确信息' WHEN 12 THEN '批量数据'
         WHEN 13 THEN '渠道精推' ELSE ''
       END AS customer_source_name,
       CASE b.special_channel WHEN 7 THEN
         CASE auc.type WHEN 1 THEN '机构渠道' WHEN 2 THEN '个人渠道' ELSE '' END
       ELSE '' END AS channel_type_name,
       a.create_time AS crm_create_time
FROM customer_info a
LEFT JOIN customer_clue_info b ON a.code = b.customer_code AND b.deleted = 0
LEFT JOIN crm_channels c  ON b.level1_channel_code = c.channel_code  AND c.channel_type = 1
LEFT JOIN crm_channels c2 ON b.level2_channel_code = c2.channel_code AND c2.channel_type = 2
LEFT JOIN crm_channels c3 ON b.level3_channel_code = c3.channel_code AND c3.channel_type = 3
LEFT JOIN crm_channels c4 ON b.level4_channel_code = c4.channel_code AND c4.channel_type = 4
LEFT JOIN admin_user_channel auc ON b.level2_channel_code = auc.id
LEFT JOIN admin_user d  ON a.create_by = d.id
LEFT JOIN admin_user d1 ON b.first_create_by = d1.id
WHERE a.code IN (...)
```
- lx_id = customer_info.code = 学员的 student_code（新数据）
- special_channel=7 时渠道走 admin_user_channel（auc），渠道类型 1机构/2个人

### 3.9 CourseAmountService.findOrderStudentStatistics
```sql
-- 订单维度：先查回款再反查课耗（s_type 非 CONSUME）
-- 查询条件基于 order_student a（a.del=0，a.id IN (<orderStudentIds>)）
-- expiration_date 约束回款/课耗的 collection_date/consume_date 时间范围
-- 最终合并计算以下统计字段（均默认 0）：
```
输出统计字段（fieldsToCopy，挂到每条回款上）：
```
arrearage_amount_total        欠费总额
arrearage_residue_amount      欠费余额
checking_amount_total         审核中金额
consume_add_count / consume_add_total                 增款课耗笔数/总额
consume_truthfull_count / consume_truthfull_total     实际课耗笔数/总额
consume_withhold_count / consume_withhold_total       扣费课耗笔数/总额
finish_course_residue_total   完课剩余
received_amount_total         已回款总额
received_count                已回款笔数
no_received_amount_total      未回款总额
residue_total                 订单剩余金额（排课可用）
order_residue_amount          订单剩余金额
```
按 `order_student_id` 关联回款行。

### 3.10 findReceivedAnnexList
```sql
SELECT GROUP_CONCAT(url) AS annex_urls, order_student_received_id
FROM order_student_received_annex
WHERE order_student_received_id IN (...)
GROUP BY order_student_received_id
```
→ annex_urls 按逗号 split 成数组。

### 3.11 findStudentTypeAndProjects
```sql
SELECT a.id AS student_id, a.edu_student_type_id, a.edu_student_type_project_id,
       a.student_code, b.crm_id, c.lx_id, c.mobile,
       d.name AS edu_student_type_name, e.name AS edu_student_type_project_name
FROM edu_student a
LEFT JOIN edu_student_party b ON a.id = b.student_id AND b.del = 0
LEFT JOIN clue c ON b.crm_id = c.lx_id
LEFT JOIN edu_student_type d ON a.edu_student_type_id = d.id
LEFT JOIN edu_student_type_project e ON a.edu_student_type_project_id = e.id
WHERE a.id IN (...)
```
按 student_id 关联，→ edu_student_type_id/project_id/name（学员维度，覆盖订单维度字段）。

### 3.12 findGoodsYearDataByIds
```sql
SELECT id, name FROM edu_goods_year WHERE id IN (...)
```
→ edu_goods_year_name（按 edu_goods_year_id 关联）。

### 3.13 findAdminPayOrders
```sql
SELECT order_student_id, admin_pay_order_id AS pay_order_id
FROM admin_pay_order_student WHERE order_student_id IN (...)
```
→ pay_order_id（按 order_student_id 关联）。

### 3.14 最初录入人/最新关键字（老/新二选一）

**老数据 findOriginOpereator → receivedService.findOriginOpereator**：
```sql
SELECT mobile, operator, time, utm_campaign
FROM clue
WHERE type = 1 AND mobile IN (...)
```
JS 逻辑：按 mobile 分组，time 升序第一条的 operator = 最初录入人（origin_operator），time 降序第一条的 utm_campaign = 最新关键字。注意：源码存在字段名不一致 bug（`mobileData.originOpereator` vs 存入的 `originOperator`）。

**新数据 findLastKeyWord → receivedService.findAllCustomerInfo**：
```sql
SELECT a.customer_code, ci1.create_time AS customer_create_time,
       cci1.keyword AS customer_keyword,
       b.customer_code AS customer_code_2, ci2.create_time AS customer2_create_time,
       cci2.keyword AS customer2_keyword,
       CASE a.concat_type WHEN 0 THEN '手机号' WHEN 1 THEN '微信号' END AS contact_type,
       a.concat AS contact_value
FROM customer_contact a ... （关联 customer_info/customer_clue_info 两套线索）
```
JS 逻辑：按 customer_code 分组，比较 customer_create_time 与 customer2_create_time 取较新一条的 keyword 作为 new_utm_campaign。

---

## 四、字段枚举

### 4.1 回款审批状态 CHECK_STAUTS（a.status）
| 值 | 含义 | 前端显示 |
|---|---|---|
| 1 | 审批中 | 待审批 |
| 2 | 驳回 | 已驳回 |
| 3 | 已通过 | 已通过 |
| 4 | 已退款 | 待退费/已退款 |
| 5 | 退款中 | 退款中 |

### 4.2 回款类型 RECEIVE_TYPE（a.type）
| 值 | 含义 |
|---|---|
| 1 | 正常回款（有正有负） |
| 2 | 退款自动生成的回款（前端显示负数） |

### 4.3 账户 ACCOUNT_TITLE_ID（a.account_title_id）
| 值 | 含义 |
|---|---|
| 22 | 欠费排课账户（account_type=1 筛选用） |
| 6 | 退款专用账户 |
| 100 | 其他账户 |
| 7 | 内部调整专户 |

### 4.4 CRM 线索枚举
| 字段 | 值 | 含义 |
|---|---|---|
| clue.type | 1 | 学通-销售线索（CLUE_TYPE.xuetong_sale） |
| clue.crm_is | 1 / 2 | 新线索 / 有效重复线索（老数据查询只取这两种） |
| b.customer_source | 1~13 | 电话呼入/新媒体运营/招生平台/渠道精推/转介绍/上门咨询/网络推广/微信咨询/渠道数据/联考/准确信息/批量数据/渠道精推 |
| b.special_channel | 7 | 特殊渠道（渠道名走 admin_user_channel，类型 1机构/2个人） |

### 4.5 CUSTOMER_ACTION（sale_customer_action 下标 → 标题）
```
0 主动咨询  1 购买优惠券  2 活动报名  3 活动现场
4 购买/赠送资料  5 合作例子  6 小程序注册  7 (空)  8 其他
```

### 4.6 其他关键常量
| 常量 | 值 | 说明 |
|---|---|---|
| NEWCRMONLINETIME | 1748707200000 | 新老数据分界 = 2025-05-31（is_old_flag==1 时 collection_date 小于该值） |
| DEFAULT_YEARS | 9 | expiration_date 默认回溯年数 |
| EXPORT_MAX_LIMIT | 5000 | 本方法导出上限，超限抛错 |
| DOWNLOAD_CENTER_EXPORT_MAX_LIMIT | 10000 | （findReceivedListNew 用的另一个方法的上限） |

---

## 五、特殊逻辑汇总

1. **新老数据双轨**：`is_old_flag` 决定三处分叉：
   - 主查询 edu_student_crm_id 来源：老=esp.crm_id（edu_student_party），新=c.student_code（edu_student）；
   - CRM 信息查询：老=clue 表 findCrmDataByCrmIds，新=customer_info 体系 findCrmDataByCrmIdsV2；
   - origin_operator：老=clue 按 mobile 分组最早 operator（有字段名 bug），新=CRM 的 origin_operator 直接取，fallback 回款自身。
   - 老数据额外条件 `a.collection_date < 1748707200000`。
2. **导出限制**：isExport 且未传 limit 时 page=1/limit=5000；count > 5000 抛错"最多导出5000条"。
3. **expiration_date**：查询时若未传自动补默认值，用于金额统计的时间窗口；计数前会 delete 掉（count 不受时间窗口影响）。
4. **数据组合顺序**：`{check_log_list, ...item, ...(crmItem||{}), ...courseFields, ...}` —— CRM 字段会覆盖回款自身同名字段（如 crm_create_time、sale_customer_action）。
5. **驳回原因**：仅 status=2 时返回最新一条 order_student_received_reject.remarks。
6. **退款回款链**：refund_order_student_received_id 指向原回款，用于查原回款类型名。
7. **潜在行膨胀**：order_contract / edu_student_party / admin_pay_order_student 均为一对多 JOIN，同一回款可能出多行。
8. **SQL 注入面**：条件拼接大量直接字符串插值（IN 列表、LIKE、数字字段未统一走 parseParamForSqlFormat，如 order_student_pattern_id、received_id、admin_division 等）。
9. **已知不准字段**：dpc.name→receved_admin_user_department_name 源码注释标明"不准！"，实际用 receved_admin_user_department_children_id 查 findCollectionDepartmentByIds 得到的全名。
10. **性能设计**：并列 Promise.all + Map 索引（O(1) 查找），替代原 findReceivedListNew 的嵌套 filter/find（O(n²)），本方法是 V2 优化版。
