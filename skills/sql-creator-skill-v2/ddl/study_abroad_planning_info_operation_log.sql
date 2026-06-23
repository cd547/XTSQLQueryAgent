CREATE TABLE `study_abroad_planning_info_operation_log` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT COMMENT '日志ID',
  `planning_info_id` bigint(11) NOT NULL COMMENT '规划信息ID',
  `operator_id` int(11) DEFAULT NULL COMMENT '操作人ID',
  `operator_name` varchar(100) DEFAULT NULL COMMENT '操作人姓名',
  `operation` varchar(255) DEFAULT NULL COMMENT '操作内容',
  `created_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_planning_info_id` (`planning_info_id`),
  KEY `idx_created_time` (`created_time`)
) ENGINE=InnoDB AUTO_INCREMENT=930 DEFAULT CHARSET=utf8mb4 COMMENT='规划信息操作日志表'