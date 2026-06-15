# `crmCustomerClueInfoPageList` 接口分析文档

## 一、接口概述

> **说明**: 客户线索分页列表查询接口
> **Controller**: `CrmCustomerClueController.crmCustomerClueInfoPageList()`
> **Service**: `CrmCustomerClueServiceImpl.crmCustomerClueInfoPageList()`
> **Mapper**: `CrmCustomerClueMapper.crmCustomerClueInfoPageList()`
> **返回 VO**: `CrmCustomerClueInfoVo`

---

## 二、涉及数据库表及关联关系

### 2.1 主表

| # | 表名 | 别名 | 说明 | JOIN 类型 |
|---|------|------|------|-----------|
| 1 | `customer_info` | `main` | **客户主表**（线索/学生基础信息） | 驱动表 (FROM) |
| 2 | `customer_clue_info` | `clue_info` | **客户线索信息表**（渠道、状态、跟进等） | `STRAIGHT_JOIN` |

### 2.2 LEFT JOIN 关联表

| # | 表名 | 别名 | 说明 | 关联条件 |
|---|------|------|------|----------|
| 3 | `customer_education_info` | `education_info` | 学生教育信息（学校、年级） | `education_info.customer_code = main.code AND education_info.deleted = 0` |
| 4 | `customer_intention_info` | `intention_info` | 意向信息（咨询意向、国家、课程、授课形式） | `intention_info.customer_code = main.code AND intention_info.deleted = 0` |
| 5 | `customer_clue_pool` | `pool` | 线索池 | `pool.customer_code = main.code AND pool.deleted = 0 AND pool.user_type = 1 AND pool.enabled = 1` |
| 6 | `admin_user` | `adminUser` | 后台用户-录入人 | `adminUser.id = main.create_by` |
| 7 | `admin_user` | `sellUser` | 后台用户-负责顾问 | `sellUser.id = clue_info.charge_person_id` |
| 8 | `admin_user` | `au1` | 后台用户-前负责人 | `au1.id = clue_info.before_charge_person_id` |
| 9 | `admin_user` | `tmkUser` | 后台用户-TMK | `tmkUser.id = clue_info.tmk_user_id` |
| 10 | `crm_channels` | `channels1` | 一级渠道 | `channels1.channel_code = clue_info.level1_channel_code` |
| 11 | `crm_channels` | `channels2` | 二级渠道 | `channels2.channel_code = clue_info.level2_channel_code` |
| 12 | `crm_channels` | `channels3` | 三级渠道 | `channels3.channel_code = clue_info.level3_channel_code` |
| 13 | `crm_channels` | `channels4` | 四级渠道 | `channels4.channel_code = clue_info.level4_channel_code` |
| 14 | `crm_channels` | `channels5` | 五级渠道 | `channels5.channel_code = clue_info.level5_channel_code` |
| 15 | `admin_user_channel` | `auc` | 用户渠道（特殊渠道时关联） | `auc.id = clue_info.level4_channel_code AND clue_info.special_channel != 0` |
| 16 | `edu_campus` | `campus` | 校区-咨询校区 | `campus.simple = clue_info.consult_campus_value AND campus.del = 0` |
| 17 | `edu_campus` | `campus2` | 校区-归属校区 | `campus2.simple = clue_info.campus_value AND campus2.del = 0` |
| 18 | `admin_user` | `campusUser` | 后台用户-校区负责人 | `campusUser.id = campus.manager_id` |
| 19 | `admin_department_children` | `adc` | 部门子表-录入人部门 | `adc.id = clue_info.create_by_dept_id` |
| 20 | `admin_department` | `ad` | 部门表 | `ad.id = adc.department_id` |

### 2.3 子查询（LEFT JOIN）

#### institution — 外推机构
```sql
SELECT cpt.customer_code,
       GROUP_CONCAT(DISTINCT cic.institution_name ORDER BY cic.institution_name SEPARATOR ',') AS institution_name,
       GROUP_CONCAT(DISTINCT cic.institution_code ORDER BY cic.institution_code SEPARATOR ',') AS institution_code
FROM customer_push_task cpt
INNER JOIN customer_institution cic ON cic.institution_code = cpt.institution_code
WHERE cpt.recommend_type IN (0,1) AND cpt.delete_flag = 0
GROUP BY cpt.customer_code
```
- 关联: `institution.customer_code = clue_info.customer_code AND clue_info.org = 3`
- 说明: recommend_type IN (0,1) 表示"机构"类型的外推

#### schoolValues — 外推学校
```sql
SELECT cpt.customer_code,
       GROUP_CONCAT(DISTINCT cic.institution_name ORDER BY cic.institution_name SEPARATOR ',') AS institution_name,
       GROUP_CONCAT(DISTINCT cic.institution_code ORDER BY cic.institution_code SEPARATOR ',') AS institution_code
FROM customer_push_task cpt
INNER JOIN customer_institution cic ON cic.institution_code = cpt.institution_code
WHERE cpt.recommend_type IN (2,3) AND cpt.delete_flag = 0
GROUP BY cpt.customer_code
```
- 关联: `schoolValues.customer_code = clue_info.customer_code AND clue_info.org = 3`
- 说明: recommend_type IN (2,3) 表示"学校"类型的外推

### 2.4 条件查询中涉及的额外表

| # | 表名 | 说明 | 关联方式 |
|---|------|------|----------|
| 21 | `customer_label_rel` | 线索标签关联表 | `EXISTS` 子查询: `clr.customer_code = main.code AND clr.deleted = 0 AND clr.label_code IN (...)` |
| 22 | `customer_contact` | 客户联系方式 | `EXISTS` 子查询：按微信号(`concat_type = 1`)或手机号(`concat_type = 0`)过滤 |

### 2.5 Java 层批量查询的额外表

| # | 表名 | 说明 | 查询方式 |
|---|------|------|----------|
| 24 | `customer_contact` | 批量查询联系方式 | `batchSelectCustomerAllContact()` 按客户编码批量查询手机号和微信号 |
| 25 | `customer_auto_assign_result` | 自动分配结果表 | `getSucessAutoAssignCustomerCodes()` 批量查询成功自动分配的线索 |
| 26 | `customer_label_rel` + `customer_label` | 线索标签（通过组件查询） | `customerCommonComponent.getCustomerLabelListMap()` 批量查询标签 |
| 27 | 跟进时长（通过组件查询） | 线索跟进时长 | `customerCommonComponent.getFollowUpDurationMap()` 批量查询 |

---

## 三、表关联关系图

```
customer_info (main)  [驱动表]
    │ STRAIGHT_JOIN
    ├── customer_clue_info (clue_info)  [1:1, 强制关联]
    │    │
    │    ├── crm_channels (channels1)  [LEFT JOIN, level1_channel_code]
    │    ├── crm_channels (channels2)  [LEFT JOIN, level2_channel_code]
    │    ├── crm_channels (channels3)  [LEFT JOIN, level3_channel_code]
    │    ├── crm_channels (channels4)  [LEFT JOIN, level4_channel_code]
    │    ├── crm_channels (channels5)  [LEFT JOIN, level5_channel_code]
    │    ├── admin_user (sellUser)     [LEFT JOIN, charge_person_id → 顾问]
    │    ├── admin_user (tmkUser)      [LEFT JOIN, tmk_user_id → TMK]
    │    ├── admin_user (au1)          [LEFT JOIN, before_charge_person_id → 前负责人]
    │    ├── admin_user_channel (auc)  [LEFT JOIN, level4_channel_code, special_channel≠0]
    │    ├── edu_campus (campus)       [LEFT JOIN, consult_campus_value → 咨询校区]
    │    ├── edu_campus (campus2)      [LEFT JOIN, campus_value → 归属校区]
    │    ├── admin_department_children (adc)  [LEFT JOIN, create_by_dept_id]
    │    │    └── admin_department (ad)       [LEFT JOIN, adc.department_id]
    │    ├── institution (子查询)      [LEFT JOIN, customer_code, org=3 → 外推机构]
    │    └── schoolValues (子查询)     [LEFT JOIN, customer_code, org=3 → 外推学校]
    │
    ├── customer_education_info (education_info)  [LEFT JOIN, customer_code → 教育信息]
    ├── customer_intention_info (intention_info)  [LEFT JOIN, customer_code → 意向信息]
    ├── customer_clue_pool (pool)                 [LEFT JOIN, customer_code → 线索池]
    ├── admin_user (adminUser)                    [LEFT JOIN, create_by → 录入人]
    ├── admin_user (campusUser)                   [LEFT JOIN, campus.manager_id → 校区负责人]
    │
    ├── customer_label_rel (条件EXISTS)  →  customer_label
    ├── customer_contact (条件EXISTS, 微信)  [concat_type = 1]
    └── customer_contact (条件EXISTS, 电话)  [concat_type = 0]
```

---

## 四、查询字段与 VO 映射

### 4.1 字段映射总表

| # | SQL 字段 | 别名(VO属性) | 数据库表 | 说明 |
|---|----------|-------------|----------|------|
| 1 | `main.code` | `clueId` | `customer_info` | 线索编码 |
| 2 | `main.name` | `studentName` | `customer_info` | 学生姓名 |
| 3 | `main.gender` | `studentSex` | `customer_info` | 学生性别 |
| 4 | `main.en_name` | `studentEnglishName` | `customer_info` | 英文名 |
| 5 | `main.repeat_type` | `repeatType` / `repeatTypeCode` | `customer_info` | 入库重复类型(code) |
| 6 | `education_info.school_name` | `school` | `customer_education_info` | 在读学校 |
| 7 | `education_info.grade_value` | `grade` | `customer_education_info` | 在读年级 |
| 8 | `clue_info.customer_action` | `customerAction` | `customer_clue_info` | 客户动作 |
| 9 | `campus.name` | `consultingCampus` | `edu_campus` | 咨询校区名称 |
| 10 | `intention_info.consult_intention` | `consultingIntent` | `customer_intention_info` | 咨询意向 |
| 11 | `intention_info.country_intention` | `countryIntentionValue` | `customer_intention_info` | 意向国家 |
| 12 | `intention_info.lesson_intention` | `courseIntent` | `customer_intention_info` | 课程意向 |
| 13 | `intention_info.class_style_intention` | `teachingFormIntent` | `customer_intention_info` | 授课形式意向 |
| 14 | `clue_info.level1_channel_code` | `levelOneChannelCode` | `customer_clue_info` | 一级渠道编码 |
| 15 | `channels1.channel_name` | `levelOneChannel` | `crm_channels` | 一级渠道名称 |
| 16 | `clue_info.level2_channel_code` | `levelTwoChannelCode` | `customer_clue_info` | 二级渠道编码 |
| 17 | `channels2.channel_name` | `levelTwoChannel` | `crm_channels` | 二级渠道名称 |
| 18 | `clue_info.level3_channel_code` | `levelThreeChannelCode` | `customer_clue_info` | 三级渠道编码 |
| 19 | `channels3.channel_name` | `levelThreeChannel` | `crm_channels` | 三级渠道名称 |
| 20 | `clue_info.level4_channel_code` | `levelFourChannelCode` | `customer_clue_info` | 四级渠道编码 |
| 21 | `channels4.channel_name` | `levelFourChannel` | `crm_channels` | 四级渠道名称 |
| 22 | `clue_info.level5_channel_code` | `levelFiveChannelCode` | `customer_clue_info` | 五级渠道编码 |
| 23 | `channels5.channel_name` | `levelFiveChannel` | `crm_channels` | 五级渠道名称 |
| 24 | `clue_info.carrier` | `carrier` | `customer_clue_info` | 载体 |
| 25 | `clue_info.utm_medium` | `utmMedium` | `customer_clue_info` | 载体(非学通) |
| 26 | `clue_info.keyword` | `keyword` | `customer_clue_info` | 关键字 |
| 27 | `clue_info.utm_campaign` | `utmCampaign` | `customer_clue_info` | utmCampaign |
| 28 | `clue_info.channel_name` | `operationalChannel` | `customer_clue_info` | 运营渠道 |
| 29 | `clue_info.utm_content` | `utmContent` | `customer_clue_info` | utmContent(非学通运营渠道) |
| 30 | `clue_info.utm_term` | `utmTerm` | `customer_clue_info` | utmTerm |
| 31 | `clue_info.utm_source` | `utmSource` | `customer_clue_info` | utmSource |
| 32 | `sellUser.user` | `sellName` | `admin_user` | 负责顾问姓名 |
| 33 | `tmkUser.user` | `tmkUserName` | `admin_user` | TMK姓名 |
| 34 | `CASE WHEN clue_info.tmk_user_id IS NOT NULL THEN '是' ELSE '否' END` | `isTmkFollowName` | — | 是否TMK跟进 |
| 35 | `adminUser.user` | `recorder` | `admin_user` | 录入人 |
| 36 | `clue_info.customer_source` | `customerSource` | `customer_clue_info` | 线索来源 |
| 37 | `clue_info.clue_flag` | `clueType` | `customer_clue_info` | 线索类型 |
| 38 | `clue_info.last_repeat_type` | `lastRepeatType` / `lastRepeatTypeCode` | `customer_clue_info` | 最新重复类型 |
| 39 | `clue_info.business_status` | `businessStatus` | `customer_clue_info` | 业务状态(A/B/C/D) |
| 40 | `clue_info.create_time` | `createTime` | `customer_clue_info` | 创建时间 |
| 41 | `clue_info.judgment_value` | `clueJudgmentValue` | `customer_clue_info` | 线索判定 |
| 42 | `campus.manager_id` | `managerId` | `edu_campus` | 校区负责人ID |
| 43 | `campusUser.user` | `managerName` | `admin_user` | 校区负责人姓名 |
| 44 | `clue_info.special_channel` | `specialChannel` | `customer_clue_info` | 特殊渠道标志 |
| 45 | `clue_info.campus_value` | `belongCampusValue` | `customer_clue_info` | 归属校区 |
| 46 | `campus2.name` | `belongCampusTitle` | `edu_campus` | 归属校区名称 |
| 47 | `clue_info.remark` | `studentRemark` | `customer_clue_info` | 学生备注 |
| 48 | `clue_info.last_follow_up_content` | `lastFollowUpContent` | `customer_clue_info` | 最新跟进记录 |
| 49 | `clue_info.sale_last_follow_up_time` | `saleLastFollowUpTime` | `customer_clue_info` | 顾问最新跟进时间 |
| 50 | `clue_info.customer_status` | `customerStatus` | `customer_clue_info` | 客户状态 |
| 51 | `clue_info.last_update_time` | `lastUpdateTime` | `customer_clue_info` | 最新更新时间 |
| 52 | `clue_info.next_follow_up_time` | `nextFollowUpTime` | `customer_clue_info` | 下次跟进时间 |
| 53 | `clue_info.follow_up_status` | `followUpStatusValue` | `customer_clue_info` | 跟进状态 |
| 54 | `clue_info.customer_type` | `customerTypeValue` | `customer_clue_info` | 客户类型 |
| 55 | `clue_info.test_time` | `testTime` | `customer_clue_info` | 测试时间 |
| 56 | `clue_info.visit_time` | `visitTime` | `customer_clue_info` | 到访时间 |
| 57 | `pool.confirm_flag` | `confirmFlag` | `customer_clue_pool` | 线索确认状态(1-未确认/2-已确认) |
| 58 | `pool.create_time` | `cluePoolCreateTime` | `customer_clue_pool` | 线索池创建时间 |
| 59 | `clue_info.first_confirm_time` | `firstConfirmTime` | `customer_clue_info` | 首次确认时间 |
| 60 | `clue_info.first_assign_sale_time` | `firstAssignSaleTime` | `customer_clue_info` | 首次分配时间 |
| 61 | `clue_info.current_process` | `currentProcessValue` | `customer_clue_info` | 当前进展 |
| 62 | `clue_info.first_create_time` | `firstCreateTime` | `customer_clue_info` | 首次创建时间 |
| 63 | `clue_info.last_assign_sale_time` | `lastAssignTime` | `customer_clue_info` | 最新分配时间 |
| 64 | `clue_info.first_follow_up_time` | `firstFollowUpTime` | `customer_clue_info` | 最初跟进时间 |
| 65 | `clue_info.before_charge_person_id` | `beforeChargePersonId` | `customer_clue_info` | 前负责人ID |
| 66 | `au1.user` | `beforeChargePersonName` | `admin_user` | 前负责人姓名 |
| 67 | `clue_info.transaction_time` | `transactionTime` | `customer_clue_info` | 成交时间 |
| 68 | `clue_info.tmk_follow_up_status` | `tmkFollowUpStatus` | `customer_clue_info` | TMK跟进状态 |
| 69 | `clue_info.tmk_next_follow_up_time` | `tmkNextFollowUpTime` | `customer_clue_info` | TMK下次跟进时间 |
| 70 | `clue_info.tmk_judgment_value` | `tmkClueJudgment` | `customer_clue_info` | TMK线索判定 |
| 71 | `clue_info.tmk_judgment_value_reason` | `tmkClueJudgmentReason` | `customer_clue_info` | TMK判定原因 |
| 72 | `clue_info.last_assign_tmk_time` | `lastAssignTmkTime` | `customer_clue_info` | TMK最新分配时间 |
| 73 | `concat(ad.name,'-',adc.name)` | `createByDeptName` | `admin_department` + `admin_department_children` | 录入人所在部门 |
| 74 | `clue_info.create_by_dept_id` | `createByDeptId` | `customer_clue_info` | 录入人所在部门ID |
| 75 | `clue_info.tmk_current_process` | `tmkCurrentProcess` | `customer_clue_info` | TMK当前进展 |
| 76 | `clue_info.quality_audit_status` | `qualityAuditStatus` | `customer_clue_info` | 质检审核状态 |
| 77 | `institution.institution_name` | `institutionValues` | 子查询 `institution` | 外推机构 |
| 78 | `schoolValues.institution_name` | `schoolValues` | 子查询 `schoolValues` | 外推学校 |
| 79 | `clue_info.extrapolate_remark` | `extrapolateRemark` | `customer_clue_info` | 外推备注 |
| 80 | `clue_info.last_follow_up_status` | `lastFollowUpStatus` | `customer_clue_info` | 最新跟进状态(国际择校) |

---

## 五、字段枚举类映射

### 5.1 `clueType` — 线索类型（`ClueFlagEnum`）

| Code | Title | 说明 |
|------|-------|------|
| 0 | 保存线索 | SAVE_CLUE |
| 1 | 保存名单 | SAVE_LIST |
| 2 | 暂不联系 | NOT_CONTACT |

### 5.2 `customerAction` / `customerActionValueList` — 客户动作（`CustomerActionEnum`）

| Code | Title |
|------|-------|
| 0 | 主动咨询 |
| 1 | 购买优惠券 |
| 2 | 活动报名 |
| 3 | 活动现场 |
| 4 | 购买/赠送资料 |
| 5 | 合作例子 |
| 6 | 小程序注册 |
| 8 | 其他 |

### 5.3 `consultingIntent` — 咨询意向（`ConsultIntentionEnum`）

| Code | Title |
|------|-------|
| 1 | 学通培训 |
| 2 | 留学 |
| 3 | 学通备考 |
| 5 | 全日制 |
| 6 | 双轨制 |
| 7 | 科桥 |
| 8 | 52择校 |
| 10 | 克勒 |
| 11 | 豆豆贝单词 |
| 100 | 码趣 |

### 5.4 `courseIntent` — 课程意向（`LessonIntentionEnum`）

| Code | Title |
|------|-------|
| 1 | ALEVEL |
| 2 | IB |
| 3 | IGCSE |
| 4 | 美高 |
| 5 | 竞赛 |
| 6 | 标化考试 |
| 7 | 附加考试 |
| 8 | 其他 |
| 9 | 留学 |
| 10 | 学通备考 |
| 12 | 全日制 |
| 13 | 双轨制 |
| 14 | 科桥 |
| 15 | 52择校 |
| 16 | 克勒 |
| 17 | AP |
| 18 | 豆豆贝单词 |
| 19 | 码趣 |

### 5.5 `teachingFormIntent` — 授课形式意向（`ClassStyleIntentionEnum`）

| Code | Title |
|------|-------|
| 1 | 1v1 |
| 2 | 线下班课 |
| 3 | 在线班课 |
| 4 | 不确定 |
| 5 | 全日制 |
| 6 | 双轨制 |

### 5.6 `grade` / `gradeValue` — 在读年级（`GradeEnum`）

| Code | Title |
|------|-------|
| 1 | 小班及学前 |
| 2 | 中班 |
| 3 | 大班 |
| 4 | G1 |
| 5 | G2 |
| 6 | G3 |
| 7 | G4 |
| 8 | G5 |
| 9 | G6 |
| 10 | G7 |
| 11 | G8 |
| 12 | G9 |
| 13 | G10 |
| 14 | G11 |
| 15 | G12 |
| 16 | 大学以上 |
| 17 | 未知 |

### 5.7 `customerSource` — 线索来源（`CustomerSourceEnum`）

| Code | Title | 适用组织 |
|------|-------|---------|
| 1 | 电话呼入 | 科桥(1), 克勒(2) |
| 2 | 新媒体运营 | 科桥(1), 克勒(2) |
| 3 | 招生平台 | 科桥(1), 克勒(2) |
| 4 | 渠道精推 | 科桥(1), 克勒(2) |
| 5 | 转介绍 | 科桥(1), 克勒(2) |
| 6 | 上门咨询 | 科桥(1), 克勒(2) |
| 7 | 网络推广 | 科桥(1), 克勒(2) |
| 8 | 微信咨询 | 科桥(1), 克勒(2) |
| 9 | 渠道数据 | 科桥(1), 克勒(2) |
| 10 | 联考 | 科桥(1), 克勒(2) |
| 11 | 准确信息 | 学通(0) |
| 12 | 名单客户 | 学通(0) |
| 13 | 精准推荐 | 学通(0) |

### 5.8 `clueJudgmentValue` / `clueJudgmentTitle` — 线索判定（`ClueJudgmentEnum`）

| Code | Title | 启用 |
|------|-------|------|
| 0 | 有效线索 | 1 |
| 1 | 未有效联系 | 1 |
| 2 | 有效粉丝 | 1 |
| 3 | 暂不联系 | 0 |
| 4 | 无效 | 1 |
| 5 | 新线索 | 0 |
| 6 | 已成单 | 0 |

### 5.9 `countryIntentionValue` / `countryIntentionTitle` — 意向国家（`CountryIntentionEnum`）

| Code | Title |
|------|-------|
| 1 | 英国 |
| 2 | 美国 |
| 3 | 澳洲 |
| 4 | 加拿大 |
| 5 | 新加坡 |
| 6 | 日本 |
| 7 | 其他 |

### 5.10 `followUpStatusValue` / `followUpStatusTitle` — 跟进状态（学通用 `FollowUpStatusEnum`，科桥/克勒用 `FollowUpStatusKqKlEnum`）

**FollowUpStatusEnum（学通 XUE_TONG, org=0）**

| Code | Title |
|------|-------|
| 0 | 未接通 |
| 1 | 跟进中 |
| 2 | 已加微信 |
| 3 | 预约 |
| 4 | 到访 |
| 5 | 未到访 |
| 6 | 无效 |

**FollowUpStatusKqKlEnum（科桥 KE_QIAO, org=1 / 克勒 KE_LE, org=2）**

| Code | Title | 启用 |
|------|-------|------|
| 20 | 新线索 | 1 |
| 21 | 未接通 | 1 |
| 22 | 跟进中 | 1 |
| 23 | 已加微信 | 1 |
| 24 | 已预约 | 1 |
| 25 | 已到访 | 1 |
| 26 | 未到访 | 1 |
| 27 | 无效 | 1 |
| 28 | 成交 | 1 |
| 29 | 放弃 | 1 |
| 30 | 已测试 | 1 |
| 31 | 长期跟进 | 0 |

### 5.11 `tmkFollowUpStatus` / `tmkFollowUpStatusTitle` — TMK跟进状态

- 学通(org=0): 使用 `FollowUpStatusEnum`
- 科桥/克勒(org=1/2): 使用 `FollowUpStatusKqKlEnum`

### 5.12 `lastFollowUpStatus` / `lastFollowUpStatusTitle` — 最新跟进状态（国际择校）

- 仅科桥/克勒(org=1/2)使用，映射 `FollowUpStatusKqKlEnum`

### 5.13 `tmkClueJudgment` / `tmkClueJudgmentTitle` — TMK线索判定

映射 `ClueJudgmentEnum`（同 5.8）

### 5.14 `tmkClueJudgmentReason` / `tmkClueJudgmentReasonTitle` — TMK判定原因（`ClueJudgmentReasonEnum`）

| Code | Title | 适用判定值 |
|------|-------|-----------|
| 101 | 联系不上 | 1(未有效联系), 4(无效) |
| 102 | 明确拒绝 | 0, 1(未有效联系), 4(无效) |
| 103 | 号码错误 | 4(无效) |
| 104 | 渊学通在读 | 4(无效) |
| 107 | 已选竞品 | 0(DEAD) |
| 108 | 无匹配方案 | 0(DEAD) |
| 109 | 个人计划变更 | 0(DEAD) |
| 110 | 长期失联 | 0(DEAD) |
| 112 | 其他 | 0(DEAD) |

### 5.15 `currentProcessValue` / `currentProcessTitle` — 当前进展（`CurrentProcessEnum`）

| Code | Title | 启用 |
|------|-------|------|
| 0 | DEAD | 1 |
| 1 | 联系不上 | 1 |
| 2 | 咨询意向 | 1 |
| 3 | LP | 1 |
| 4 | HP | 1 |
| 5 | DEAL | 1 |
| 6 | MP | 0 |

### 5.16 `tmkCurrentProcess` / `tmkCurrentProcessTitle` — TMK当前进展

映射 `CurrentProcessEnum`（同 5.15）

### 5.17 `customerTypeValue` / `customerTypeTitle` — 客户类型（`CustomerTypeEnum`）

| Code | Title | 启用 | 适用组织 |
|------|-------|------|---------|
| 1 | 待判定 | 1 | 科桥(1), 克勒(2) |
| 2 | 2021秋招 | 1 | 科桥(1) |
| 3 | 2021春招 | 1 | 科桥(1) |
| 4 | 2022秋招 | 1 | 科桥(1) |
| 5 | 2022春招 | 1 | 科桥(1) |
| 6 | 2023秋招 | 1 | 科桥(1) |
| 7 | 2023春招 | 1 | 科桥(1) |
| 8 | 2024秋招 | 1 | 科桥(1), 克勒(2) |
| 9 | 2024春招 | 1 | 科桥(1), 克勒(2) |
| 10 | 2025秋招 | 1 | 科桥(1), 克勒(2) |
| 11 | 2025春招 | 1 | 科桥(1), 克勒(2) |
| 12 | 2026秋招 | 1 | 学通(0), 科桥(1), 克勒(2) |
| 13 | 2026春招 | 1 | 学通(0), 科桥(1), 克勒(2) |
| 14 | 国际高中在读 | 1 | 学通(0), 科桥(1), 克勒(2) |
| 30 | 2027以后 / 一周可成交 | 1/0 | 学通(0), 科桥(1), 克勒(2) |
| 31 | 三个月可成交 | 0 | 学通(0), 科桥(1), 克勒(2) |
| 32 | 2027春招 | 1 | 择校圈(3) |
| 33 | 2027秋招 | 1 | 择校圈(3) |
| 34 | 26年小学插班 | 1 | 择校圈(3) |
| 35 | 27年小学插班 | 1 | 择校圈(3) |
| 36 | 26年初中插班 | 1 | 择校圈(3) |
| 37 | 27年初中插班 | 1 | 择校圈(3) |
| 38 | 外籍 | 1 | 择校圈(3) |
| 39 | 其他 | 1 | 择校圈(3) |

### 5.18 `repeatType` / `repeatTypeCode` / `lastRepeatType` — 重复类型（`CustomerRepeatTypeEnum`）

| Code | Title |
|------|-------|
| 0 | 新线索 |
| 1 | 有效重复 |
| 2 | 无效重复 |

### 5.19 `customerStatus` — 客户状态（`CustomerStatusEnum`）

| Code | Title | 类别 |
|------|-------|------|
| 100 | D-新线索 | D |
| 102 | D-待分配tmk | D |
| 103 | D-tmk跟进中 | D |
| 104 | D-tmk放弃 | D |
| 108 | D-市场放弃 | D |
| 109 | D-待自动分配 | D |
| 110 | D-自动分配中 | D |
| 201 | B-顾问跟进中 | B |
| 202 | B-已转学员 | B |
| 300 | 顾问放弃(废弃) | C |
| 301 | C-顾问主管置入公海 | C |
| 302 | C-顾问置入公海 | C |
| 303 | C-顾问30天未跟进抽回 | C |
| 304 | C-待分配顾问 | C |
| 305 | C-待自动分配 | C |
| 306 | C-待分配tmk | C |
| 307 | C-tmk跟进中 | C |
| 308 | C-tmk置入公海 | C |
| 309 | C-自动分配中 | C |
| 403 | 试听课订单 | A(订单) |
| 404 | 正式课订单 | A(订单) |

### 5.20 `qualityAuditStatus` / `qualityAuditStatusTitle` — 质检审核状态（`QualityAuditStatusEnum`）

仅当 `businessStatus = 'A'` 且 `customerStatus ∈ (403, 404)` 时显示，否则显示 `"—"`。

| Code | Title |
|------|-------|
| 0 | 待审核 |
| 1 | 审核通过 |
| 2 | 已驳回 |

### 5.21 `confirmFlag` / `confirmFlagTitle` — 线索确认状态

| Code | Title |
|------|-------|
| 1 | 未确认 |
| 2 | 已确认 |

> 注: 标题映射由 `customerCommonComponent.getConfirmTitle()` 处理

### 5.22 `specialChannel` — 特殊渠道

| Code | 说明 |
|------|------|
| 0 | 默认（普通渠道） |
| 1 | 渠道精推-个人渠道 |
| 2 | 渠道精推-机构渠道 |
| 3 | 渠道数据-个人渠道 |
| 4 | 渠道数据-机构渠道 |
| 7 | 特殊处理：从 `admin_user_channel` 获取渠道简称和类型 |

### 5.23 `channelType` / `channelTypeTitle` — 渠道类型（`ChannelTypeEnum`）

仅当 `specialChannel = 7` 时有值。

| Code | Title |
|------|-------|
| 1 | 机构渠道 |
| 2 | 个人渠道 |

### 5.24 `org` — 组织（`OrgEnum`）

| Code | Title | 前缀 |
|------|-------|------|
| 0 | 渊学通 | XT1 |
| 1 | 科桥国际部 | KQ1 |
| 2 | 克勒国际部 | KL1 |
| 3 | 择校圈 | ZX1 |

### 5.25 `contactType` — 联系方式类型（`ContactTypeEnum`）

| Code | Title |
|------|-------|
| 0 | 手机号 |
| 1 | 微信号 |
| 2 | 邮箱 |

### 5.26 `fieldSource` — 列表来源（`FieldSourceEnum`）

| Code | Title |
|------|-------|
| 1 | TMK线索列表 |
| 2 | 跟进池列表 |
| 3 | 分配池列表 |
| 4 | 公海池列表 |
| 5 | 全部线索列表 |
| 6 | 毛线索列表 |
| 8 | 渠道佣金待审批列表 |
| 9 | 成交池列表 |
| 10 | 线索合并列表 |
| 11 | TMK已递交列表 |
| 13 | 质检审核列表 |

---

## 六、排序字段 (`sortFieldFlag`)

| sortFieldFlag | 排序字段 | 说明 |
|:---:|---|------|
| 0 | `clue_info.first_create_time` | 首次创建时间 |
| 1 | `clue_info.create_time` | 创建时间 |
| 2 | `clue_info.repeat_customer_time` | 重复客户时间 |
| 3 | `clue_info.first_assign_sale_time` | 首次分配销售时间 |
| 4 | `clue_info.last_assign_sale_time` | 最近分配销售时间 |
| 5 | `clue_info.sale_last_follow_up_time` | 最新跟进时间 |
| 6 | `clue_info.next_follow_up_time` | 下次跟进时间 |
| 7 | `clue_info.visit_time` | 到访时间 |
| 8 | `clue_info.test_time` | 测试时间 |
| 10 | `clue_info.last_assign_tmk_time` | TMK最新分配时间 |
| 默认 | `clue_info.create_time` | 默认按创建时间 |

> `ascFlag = true` 为升序，否则降序。

---

## 七、业务逻辑说明

### 7.1 数据权限控制
- 通过 `buildParam(search)` 方法实现：
  - 若当前用户不在白名单(`whiteAdminIdList`)中，则设置 `createUserIds` 为用户可见的权限用户ID列表
  - 非 TMK 查询模式下(`queryTmkFlag != true`)：数据过滤条件为 `main.create_by IN (权限用户IDs) OR auc.maintainer_id IN (权限用户IDs) OR campus2.manager_id = 当前用户ID`
  - TMK 查询模式下(`queryTmkFlag == true`)：限制 `customer_status IN (103,307)`（D-tmk跟进中, C-tmk跟进中）且 `last_repeat_type IN (0,1)`（新线索/有效重复）

### 7.2 字段列表自定义
- 查询 `crm_standard_field` 获取标准字段列表
- 查询 `crm_user_defined_field` 获取用户自定义字段配置（排序、显隐、固定）
- 用户自定义字段覆盖标准字段的排序和显隐配置

### 7.3 批量查询（Java层）
1. 批量查询联系方式 → 手机号脱敏/加密，微信号脱敏/加密
2. 批量查询自动分配结果 → 设置 `isAutoAssignStr`（是否自动分配）
3. 批量查询线索标签 → 设置 `labelList` / `labelNameListStr`
4. 批量查询跟进时长 → 设置 `followUpDuration`

### 7.4 特殊渠道处理
- 当 `specialChannel = 7` 时，从 `admin_user_channel` 获取渠道简称和类型
- 此时二级渠道名称替换为渠道简称(`channel_abbreviation`)
