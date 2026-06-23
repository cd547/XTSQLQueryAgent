CREATE TABLE `study_abroad_apply_online_person_info` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `student_id` bigint(11) NOT NULL COMMENT '学生ID',
  `operator_id` int(11) DEFAULT NULL COMMENT '操作人ID',
  `operation_time` datetime NOT NULL COMMENT '操作时间',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_operation_time` (`operation_time`)
) ENGINE=InnoDB AUTO_INCREMENT=36 DEFAULT CHARSET=utf8mb4 COMMENT='留学网申个人信息表'