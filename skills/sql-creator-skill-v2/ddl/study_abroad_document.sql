CREATE TABLE `study_abroad_document` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `student_id` bigint(11) NOT NULL COMMENT '学生ID',
  `application_country` varchar(255) DEFAULT NULL COMMENT '申请国家',
  `application_major` varchar(255) DEFAULT NULL COMMENT '申请专业',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `study_abroad_major_id` bigint(20) DEFAULT NULL COMMENT '专业方向ID',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=59 DEFAULT CHARSET=utf8mb4 COMMENT='留学文书表'