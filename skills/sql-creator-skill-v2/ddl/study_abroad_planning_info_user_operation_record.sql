CREATE TABLE `study_abroad_planning_info_user_operation_record` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT COMMENT '记录ID',
  `student_id` bigint(11) DEFAULT NULL COMMENT '用户ID',
  `planning_info_id` bigint(11) NOT NULL COMMENT '规划信息ID',
  `last_step` int(11) DEFAULT '1' COMMENT '最后操作步骤：1-基本信息 2-申请目标 3-教育经历 4-查看页面',
  `last_operation_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '最后操作时间',
  `created_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_planning` (`student_id`,`planning_info_id`) COMMENT '用户-规划信息唯一索引',
  KEY `idx_planning_info_id` (`planning_info_id`),
  KEY `idx_last_operation_time` (`last_operation_time`)
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COMMENT='规划信息用户操作记录表'