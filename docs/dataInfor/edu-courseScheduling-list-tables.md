# 排课列表 — 数据表知识库（供 SQL 生成）

> 依据：`GET /api/edu/courseScheduling/List` 及其导出 `/List/export` 的查询实现（controllers/edu/courseScheduling.js → module/edu/courseScheduling.js）
> 用途：SQL 生成 agent 的数据字典。字段中文名参考排课列表导出 Excel 列。

---

## 1. 表总览

| 表名 | 中文说明 | 角色 |
| --- | --- | --- |
| `edu_study` | 排课主表（含教研活动 type=3） | 主表 |
| `edu_study_student` | 排课-学员关联表 | 关联 |
| `edu_student` | 学员表 | 关联 |
| `edu_student_type` | 学员类型字典 | 字典 |
| `edu_student_personnel` | 学员-工作人员关联表（助教/客服/老师/顾问/家长） | 关联 |
| `edu_campus_school_class` | 教室表 | 关联 |
| `edu_campus_school` | 分校 | 关联 |
| `edu_campus` | 校区 | 关联 |
| `edu_course` | 一级课程 | 字典 |
| `edu_course_exam` | 考试 | 字典 |
| `edu_course_exam_subject` | 三级科目 | 字典 |
| `edu_course_exam_subject_name` | 四级科目名（最细粒度，排课直接引用） | 字典 |
| `edu_class_type` | 班型字典 | 字典 |
| `edu_teacher` | 老师档案（主键为 admin_user_id） | 关联 |
| `admin_user` | 后台用户（操作人/老师/工作人员统用） | 关联 |
| `edu_room` | 班级 | 关联 |
| `edu_room_study` | 班级-排课关联 | 关联 |
| `edu_video` | 视频 | 关联 |
| `edu_video_address` | 视频地址（1:N） | 关联 |
| `edu_study_feedback` | 考勤反馈 | 关联 |
| `edu_study_feedback_type` | 反馈类型字典 | 字典 |
| `edu_adjust_study` | 调课申请单 | 关联 |
| `order_student_consume` | 课耗记录（订单扣费） | 关联 |
| `teacher_work` | 老师排班/排休时间点 | 关联 |
| `xuetong_study_log` | 排课操作日志 | 关联 |
| `edu_pre_study` | 预排课主表（镜像 edu_study） | 主表（预排课场景） |
| `edu_pre_study_student` | 预排课-学员关联（镜像 edu_study_student） | 关联（预排课场景） |

---

## 2. 表关系与 JOIN 路径

### 2.1 外键关系清单（围绕 edu_study）

| 子表.字段 | → 父表.字段 | 关系 | 说明 |
| --- | --- | --- | --- |
| `edu_study.edu_campus_school_class_id` | `edu_campus_school_class.id` | N:1 | 教室；教研活动可为 NULL |
| `edu_campus_school_class.campus_school_id` | `edu_campus_school.id` | N:1 | 教室所属分校 |
| `edu_campus_school.campus_id` | `edu_campus.id` | N:1 | 分校所属校区 |
| `edu_study.edu_course_exam_subject_name_id` | `edu_course_exam_subject_name.id` | N:1 | 四级科目名 |
| `edu_course_exam_subject_name.subject_id` | `edu_course_exam_subject.id` | N:1 | 三级科目 |
| `edu_course_exam_subject.exam_id` | `edu_course_exam.id` | N:1 | 考试 |
| `edu_course_exam.course_id` | `edu_course.id` | N:1 | 一级课程 |
| `edu_study.edu_class_type_id` | `edu_class_type.id` | N:1 | 班型 |
| `edu_study.edu_admin_user_id` | `admin_user.id`（= edu_teacher.admin_user_id） | N:1 | 授课老师 |
| `edu_teacher.admin_user_id` | `admin_user.id` | 1:1 | 老师档案主键即后台用户ID |
| `edu_study.admin_user_id` | `admin_user.id` | N:1 | 创建人/操作人 |
| `edu_study_student.edu_study_id` | `edu_study.id` | N:1 | 排课-学员 |
| `edu_study_student.edu_student_id` | `edu_student.id` | N:1 | |
| `edu_student.edu_student_type_id` | `edu_student_type.id` | N:1 | 学员类型 |
| `edu_student_personnel.student_id` | `edu_student.id` | N:1 | 学员-工作人员（type 区分角色） |
| `edu_room_study.edu_study_id` | `edu_study.id` | N:1 | 班级-排课 |
| `edu_room_study.edu_room_id` | `edu_room.id` | N:1 | |
| `edu_video.edu_study_id` | `edu_study.id` | N:1 | 视频 |
| `edu_video_address.edu_video_id` | `edu_video.id` | N:1 | 视频地址（一个视频多条地址） |
| `edu_study_feedback.edu_study_id` | `edu_study.id` | N:1 | 考勤反馈 |
| `edu_study_feedback.edu_study_feedback_type_id` | `edu_study_feedback_type.id` | N:1 | 反馈类型 |
| `edu_study_feedback.admin_user_id` | `admin_user.id` | N:1 | 反馈人 |
| `edu_adjust_study.old_study_id` | `edu_study.id` | N:1 | 调课申请（旧排课） |
| `order_student_consume.edu_study_id` | `edu_study.id` | N:1 | 课耗 |
| `order_student_consume.edu_student_id` | `edu_student.id` | N:1 | |
| `order_student_consume.order_student_id` | 订单子表（order_student） | N:1 | 扣费订单 |
| `teacher_work.admin_user_id` | `admin_user.id` | N:1 | 老师排班时间点 |
| `xuetong_study_log.edu_study_id` | `edu_study.id` | N:1 | 操作日志 |

### 2.2 常用 JOIN 路径（SQL 片段）

```sql
-- 校区/教室/分校（三层）
LEFT JOIN edu_campus_school_class b ON a.edu_campus_school_class_id = b.id
LEFT JOIN edu_campus_school      c ON b.campus_school_id = c.id
LEFT JOIN edu_campus             d ON c.campus_id = d.id

-- 科目（四层：课程→考试→三级科目→四级科目名）
LEFT JOIN edu_course_exam_subject_name e  ON a.edu_course_exam_subject_name_id = e.id
LEFT JOIN edu_course_exam_subject       f  ON e.subject_id = f.id
LEFT JOIN edu_course_exam               g  ON f.exam_id = g.id
LEFT JOIN edu_course                    h  ON g.course_id = h.id

-- 学员（排课→学员，仅 type=1 学员）
LEFT JOIN edu_study_student x ON x.edu_study_id = a.id
LEFT JOIN edu_student       y ON x.edu_student_id = y.id AND y.del = 0 AND y.type = 1

-- 老师/创建人
LEFT JOIN edu_teacher m ON a.edu_admin_user_id = m.admin_user_id
LEFT JOIN admin_user  u ON a.admin_user_id = u.id

-- 班级
LEFT JOIN edu_room_study r ON r.edu_study_id = a.id
LEFT JOIN edu_room       r2 ON r.edu_room_id = r2.id

-- 视频
LEFT JOIN edu_video v ON a.id = v.edu_study_id AND v.del = 0
LEFT JOIN edu_video_address va ON v.id = va.edu_video_id AND va.del = 0
```

---

## 3. 字段定义

> 类型说明：代码未提供 DDL，类型为按用途推断的合理约定（`BIGINT` 时间戳 = 13 位毫秒；`TINYINT` 枚举；`DECIMAL` 金额/课时）。中文名参考导出列。

### 3.1 `edu_study` 排课主表

| 字段 | 类型 | 中文名（参考导出列） | 说明/枚举 |
| --- | --- | --- | --- |
| `id` | BIGINT PK | 排课ID | |
| `type` | TINYINT | 排课类型 | 1 线下课 / 2 网课 / 3 活动(教研活动) / 4 classin网课 |
| `status` | TINYINT | 排课状态 | 1 未结课 / 2 已结课（已结课不允许删除） |
| `class_time_start` | BIGINT | 上课开始时间 | 13 位毫秒时间戳 |
| `class_time_end` | BIGINT | 上课结束时间 | 13 位毫秒时间戳 |
| `class_hour` | DECIMAL | 课时 | 0.25 的倍数，最大 4 |
| `class_week` | TINYINT | 星期 | 0 周日 / 1~6 周一~周六 |
| `edu_campus_school_class_id` | BIGINT | 教室 | FK；教研活动可为 NULL |
| `edu_course_exam_subject_name_id` | BIGINT | 四级科目名 | FK |
| `edu_class_type_id` | BIGINT | 班型 | FK |
| `edu_admin_user_id` | BIGINT | 授课老师 | FK → admin_user.id |
| `admin_user_id` | BIGINT | 操作人（创建人） | FK → admin_user.id |
| `english_teaching` | TINYINT | 是否英语授课 | 1 否 / 2 是 |
| `jingsai_teaching` | TINYINT | 是否竞赛 | 1 否 / 2 是 |
| `trial_teaching` | TINYINT | 是否试听课 | 1 否 / 2 是 |
| `classin_course_id` | VARCHAR | classin网课ID | 仅 type=4 有值 |
| `classin_class_id` | VARCHAR | classin班级ID | |
| `is_video` | TINYINT | 是否选择关联视频 | 0/1（排课时选项） |
| `is_send` | TINYINT | 同步/推送标记 | 编辑时置 1 |
| `remarks` | VARCHAR | 备注 | |
| `created_time` | BIGINT | 创建时间 | 13 位毫秒 |
| `update_time` | BIGINT | 更新时间（结课时间） | 13 位毫秒；status=2 时即结课/考勤时间 |
| `del` | TINYINT | 逻辑删除 | 0 正常 / 1 删除；**所有查询强制 del = 0** |

### 3.2 关联表

**edu_study_student**（排课-学员）
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | BIGINT PK | |
| `edu_study_id` | BIGINT FK | → edu_study.id |
| `edu_student_id` | BIGINT FK | → edu_student.id |
| `admin_user_id` | BIGINT | 操作人 |
| `created_time` | BIGINT | |

**edu_student**（学员）
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | BIGINT PK | 学员ID |
| `name` | VARCHAR | 学员姓名 |
| `type` | TINYINT | **1 学员 / 2 客户管理（排课只关联 type=1）** |
| `del` | TINYINT | 0 正常 / 1 删除 |
| `edu_student_type_id` | BIGINT FK | → edu_student_type.id |

**edu_student_type**（学员类型字典）：`id`、`name`

**edu_student_personnel**（学员-工作人员）
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `student_id` | BIGINT FK | → edu_student.id |
| `admin_user_id` | BIGINT FK | → admin_user.id |
| `type` | TINYINT | 1 助教 / 2 客服 / 3 老师 / 4 顾问 / 5 家长 |
| `del` | TINYINT | |

**edu_campus_school_class**（教室）
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | BIGINT PK | 教室ID |
| `name` | VARCHAR | 教室名称 |
| `num` | VARCHAR | 教室编号 |
| `type` | TINYINT | 2 = 锁定教室（排课冲突校验跳过） |
| `campus_school_id` | BIGINT FK | → edu_campus_school.id |

**edu_campus_school**（分校）：`id`、`name`、`campus_id` FK
**edu_campus**（校区）：`id`、`name`

**科目四层字典表**（均有 `id`、`name`）：
| 表 | 层级 | 外键 |
| --- | --- | --- |
| `edu_course` | 一级课程 | — |
| `edu_course_exam` | 考试 | `course_id` → edu_course.id |
| `edu_course_exam_subject` | 三级科目 | `exam_id` → edu_course_exam.id |
| `edu_course_exam_subject_name` | 四级科目名 | `subject_id` → edu_course_exam_subject.id |

> 导出列"科目名称" = `课程.name - 考试.name - 三级科目.name - 四级科目名.name` 拼接。

**edu_class_type**（班型）：`id`、`name`（班型名）、`num`（班型编号）

**edu_teacher**（老师）：`admin_user_id`（主键，= admin_user.id）、`name`（老师姓名）、`del`

**admin_user**（后台用户）：`id`、`user`（登录名/显示名）、`mobile`

**edu_room**（班级）：`id`、`name`
**edu_room_study**（班级-排课）：`id`、`edu_room_id` FK、`edu_study_id` FK、`del`

**edu_video**（视频）：`id`、`edu_study_id` FK、`del`
**edu_video_address**（视频地址）：`id`、`edu_video_id` FK、`original_url`、`new_url`（取用优先级 new_url > original_url）、`del`

**edu_study_feedback**（考勤反馈）：`id`、`edu_study_id` FK、`edu_study_feedback_type_id` FK、`remarks`、`admin_user_id` FK、`created_time`
**edu_study_feedback_type**（反馈类型字典）：`id`、`name`

**edu_adjust_study**（调课申请单）：`id`、`old_study_id` FK → edu_study.id（1 条排课可有多个申请）、`adjust_status`（1 待调整/2 系统成功/3 系统失败/4 手动成功）、`valid`（1 审核中/2 通过/3 驳回/4 撤销）、`del`

**order_student_consume**（课耗记录）：`id`、`edu_study_id` FK、`edu_student_id` FK、`order_student_id` FK（扣费订单）、`amount`（课耗金额，单位分）、`status`（1 预扣 / 2 实扣）、`del`

**teacher_work**（老师排班时间点）：`id`、`admin_user_id` FK、`work_time`（毫秒时间戳）、`del`

**xuetong_study_log**（排课日志）：`id`、`edu_study_id` FK、`type`、`admin_user_id`、`remarks`、`created_time`

### 3.3 预排课表（`edu_pre_study` / `edu_pre_study_student`）

结构镜像 edu_study / edu_study_student（字段同上），差异字段：
| 表 | 字段 | 说明 |
| --- | --- | --- |
| `edu_pre_study` | `sync_status` | 0 未同步 / 1 已同步 / 2 同步失败 |
| `edu_pre_study` | `sync_edu_study_id` | 同步后生成的正式排课 ID（→ edu_study.id） |
| `edu_pre_study` | `sync_remarks` | 同步备注 |
| `edu_pre_study_student` | `edu_pre_study_id` | FK → edu_pre_study.id（对应正式表的 edu_study_id） |

---

## 4. 枚举字典

| 枚举字段 | 值 | 含义 |
| --- | --- | --- |
| `edu_study.status` | 1 | 未结课（初始化） |
| | 2 | 已结课 |
| `edu_study.type` | 1 | 线下课 |
| | 2 | 网课 |
| | 3 | 活动（教研活动） |
| | 4 | classin网课 |
| `edu_study.english_teaching` / `jingsai_teaching` / `trial_teaching` | 1 | 否 |
| | 2 | 是 |
| `edu_study.class_week` | 0 | 周日 |
| | 1~6 | 周一~周六 |
| `edu_study.del`（全部表） | 0 | 正常 |
| | 1 | 逻辑删除 |
| `edu_student.type` | 1 | 学员 |
| | 2 | 客户管理 |
| `edu_student_personnel.type` | 1 | 助教 |
| | 2 | 客服 |
| | 3 | 老师 |
| | 4 | 顾问 |
| | 5 | 家长 |
| `edu_campus_school_class.type` | 2 | 锁定教室 |
| `edu_adjust_study.adjust_status` | 1 | 待调整 |
| | 2 | 系统调整成功 |
| | 3 | 系统调整失败 |
| | 4 | 手动调整成功 |
| `edu_adjust_study.valid` | 1 | 审核中 |
| | 2 | 通过 |
| | 3 | 驳回 |
| | 4 | 撤销 |
| `order_student_consume.status` | 1 | 预扣 |
| | 2 | 实扣（结课时由 1→2） |
| `edu_pre_study.sync_status` | 0 | 未同步 |
| | 1 | 已同步 |
| | 2 | 同步失败 |

---

## 5. SQL 生成规则

### 5.1 通用过滤条件（WHERE 必带）
- 主表：`a.del = 0`。
- 关联学员表：`y.del = 0 AND y.type = 1`（只关联"学员"，排除"客户管理"）。
- 关联工作人员表：`sp.del = 0`。
- 关联调课/课耗/视频/教室关联表：`del = 0`。

### 5.2 筛选参数 → WHERE 生成映射

| 入参 | 目标字段 | SQL 写法 |
| --- | --- | --- |
| 学员姓名 `name`（模糊） | 学员表 | `a.id IN (SELECT x.edu_study_id FROM edu_study_student x LEFT JOIN edu_student y ON x.edu_student_id = y.id AND y.type = 1 WHERE y.name LIKE '%xx%')` |
| 学员ID `student_id` | 学员表 | `a.id IN (SELECT x.edu_study_id FROM edu_study_student x LEFT JOIN edu_student y ON x.edu_student_id = y.id AND y.type = 1 WHERE x.edu_student_id = ?)` |
| 日期区间 `class_date_start/end` | `class_time_start` | `a.class_time_start >= start AND a.class_time_start <= end`（区间必须成对） |
| 科目名 `subject_name`（模糊，任意层级） | 四级科目名表 | `a.edu_course_exam_subject_name_id IN (SELECT e.id FROM edu_course_exam_subject_name e LEFT JOIN edu_course_exam_subject f ON e.subject_id = f.id LEFT JOIN edu_course_exam ece ON f.exam_id = ece.id LEFT JOIN edu_course ec ON ece.course_id = ec.id WHERE f.name LIKE ? OR e.name LIKE ? OR ece.name LIKE ? OR ec.name LIKE ?)` |
| 四级科目名 `level4_subject_name`（模糊） | 四级科目名表 | `a.edu_course_exam_subject_name_id IN (SELECT e.id FROM edu_course_exam_subject_name e WHERE e.name LIKE ?)` |
| 三级科目ID `subject_id` | 四级科目名表 | `a.edu_course_exam_subject_name_id IN (SELECT e.id FROM edu_course_exam_subject_name e LEFT JOIN edu_course_exam_subject f ON e.subject_id = f.id WHERE f.id = ?)` |
| 一级课程ID `edu_course_id` | 四级科目名表 | `a.edu_course_exam_subject_name_id IN (SELECT bb.id FROM edu_course_exam_subject_name bb LEFT JOIN edu_course_exam_subject cc ON bb.subject_id = cc.id LEFT JOIN edu_course_exam dd ON cc.exam_id = dd.id LEFT JOIN edu_course ee ON dd.course_id = ee.id WHERE ee.id = ?)` |
| 老师姓名 `teacher_name`（模糊） | 老师表 | `a.edu_admin_user_id IN (SELECT j.admin_user_id FROM edu_teacher j WHERE j.name LIKE ?)` |
| 老师ID `teacher_id` | 主表 | `a.edu_admin_user_id = ?` |
| 状态 `status` | 主表 | `a.status = ?`（预排课为 `a.sync_status = ?`） |
| 课程类型 `type` | 主表 | `a.type = ?` |
| 校区多选 `school_id` | 教室表 | `a.edu_campus_school_class_id IN (SELECT b.id FROM edu_campus_school_class b LEFT JOIN edu_campus_school c ON b.campus_school_id = c.id WHERE c.id IN (...))` |
| 教室ID `class_id` | 主表 | `a.edu_campus_school_class_id = ?` |
| 班型 `class_type`（逗号串） | 主表 | `a.edu_class_type_id IN (...)` |
| 星期 `class_week` | 主表 | `a.class_week = ?` |
| 排课ID `study_id` / `id` | 主表 | `a.id = ?` |
| 班级 `edu_room_id` | 班级关联表 | `a.id IN (SELECT edu_study_id FROM edu_room_study WHERE edu_room_id = ?)` |
| 备注 `remarks`（模糊） | 主表 | `a.remarks LIKE ?` |
| 创建人 `created_admin_user_id` | 主表 | `a.admin_user_id = ?` |

### 5.3 课程模块（type）过滤规则
- 默认（不传 course_module）：`a.type IN (1, 2, 4)` —— 排除活动。
- `course_module = 1`（教研活动）：`a.type = 3`。
- 教研活动场景可存在无教室数据：`a.edu_campus_school_class_id IS NULL`。

### 5.4 排序规则
| 场景 | ORDER BY |
| --- | --- |
| 按创建人查（我的排课） | `a.id DESC` |
| 教研活动 | `a.class_time_start DESC` |
| 小程序 | `a.class_time_start ASC` |
| 默认 | `a.status ASC, a.class_time_start ASC`（class_time_sort=2 时开始时间 DESC） |
| 预排课默认 | `a.sync_status, a.class_time_start, a.created_time` |

### 5.5 分页
- `LIMIT offset, limit`（limit 最大 30000）。
- 栅格模式（学员课表，is_student_grids=1）：固定 `page=1, limit=2500`，日期区间缺省时默认当月。

### 5.6 派生/聚合字段（可选输出的计算列）
| 输出字段 | 计算方式 |
| --- | --- |
| `student_list` / `student_names` | `GROUP_CONCAT(b.edu_student_id) / GROUP_CONCAT(c.name)`（按 edu_study.id 分组，关联 y.type=1 学员） |
| `study_video_status` | 是否有视频：`IF(IFNULL(GROUP_CONCAT(edu_video.id),'') = '', 0, 1)` |
| `total_amount`（课耗合计） | `SUM(order_student_consume.amount)`，单位**分**（除以 100 为元） |
| `student_order`（学员-订单映射） | `GROUP_CONCAT(consume.edu_student_id, '-', consume.order_student_id)` |
| `videourl` | 多个地址用 `\r\n` 拼接，优先 `new_url` 再 `original_url` |
| 小时数 | `(class_time_end - class_time_start) / 3600000` |
| 科目名称（导出） | 四级字典 `CONCAT(课程.name, '-', 考试.name, '-', 三级.name, '-', 四级.name)` |
| 上课校区（导出） | `CONCAT(校区.name, '-', 分校.name)` |
| 状态中文（导出） | `CASE WHEN a.status = 1 THEN '未结课' ELSE '已结课' END` |

### 5.7 调课状态派生（可选项）
- 是否有"正在处理的调课申请"：
  `EXISTS (SELECT 1 FROM edu_adjust_study WHERE old_study_id = a.id AND del = 0 AND ((adjust_status = 3) OR (adjust_status = 1 AND valid = 1)))`
- 是否有"待调整"申请（锁定排课操作）：
  `EXISTS (SELECT 1 FROM edu_adjust_study WHERE old_study_id = a.id AND del = 0 AND adjust_status = 1 AND valid = 1)`

### 5.8 预排课差异
- 主表换 `edu_pre_study`（别名 a），学员关联表换 `edu_pre_study_student`（`edu_pre_study_id` 关联）。
- `status` 筛选对应 `sync_status`。
- 学员列表直接关联行返回（含 `edu_student_type_id`/`edu_student_type_name`），非逗号串。
