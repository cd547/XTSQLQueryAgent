CREATE TABLE `study_abroad_offer_info` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `apply_online_id` bigint(11) DEFAULT NULL COMMENT '网申信息ID',
  `final_school` int(11) NOT NULL DEFAULT '0' COMMENT '是否是最终入读学校（0表示不是，1表示是）',
  `student_id` bigint(11) NOT NULL COMMENT '学生ID',
  `offer_condition` text COMMENT 'offer条件',
  `offer_cash_pledge` text COMMENT 'offer押金',
  `offer_expiration_date` datetime DEFAULT NULL COMMENT 'offer截止日期',
  `language_reach` varchar(20) DEFAULT NULL COMMENT '语言达标情况',
  `academic_reach` varchar(20) DEFAULT NULL COMMENT '学术达标情况',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=74 DEFAULT CHARSET=utf8mb4 COMMENT='留学offer表'