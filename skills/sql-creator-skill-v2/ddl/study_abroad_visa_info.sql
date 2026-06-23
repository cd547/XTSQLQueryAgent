CREATE TABLE `study_abroad_visa_info` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `offer_id` bigint(11) DEFAULT NULL COMMENT 'offer的ID',
  `status` int(11) NOT NULL COMMENT '签证进度(0:未提交 1:已提交 2:已获得 3:被拒签)',
  `student_id` bigint(11) NOT NULL COMMENT '学生ID',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=47 DEFAULT CHARSET=utf8mb4 COMMENT='留学签证表'