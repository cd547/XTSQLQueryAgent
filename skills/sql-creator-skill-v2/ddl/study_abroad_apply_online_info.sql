CREATE TABLE `study_abroad_apply_online_info` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `book_id` bigint(11) NOT NULL COMMENT '定校书ID',
  `student_id` bigint(11) NOT NULL COMMENT '学生ID',
  `status` int(11) NOT NULL DEFAULT '0' COMMENT '操作字段(0:未提交 1:已提交 2:已录取 3:已放弃)',
  `interview` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否有面试（0表示没有面试，1表示有面试）',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=105 DEFAULT CHARSET=utf8mb4 COMMENT='留学网申信息主表'