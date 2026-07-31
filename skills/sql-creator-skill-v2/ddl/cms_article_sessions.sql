CREATE TABLE `cms_article_sessions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT 'ID主键',
  `cms_article_id` int(10) unsigned NOT NULL COMMENT '关联活动ID',
  `session_name` varchar(63) NOT NULL COMMENT '场次名称',
  `session_location` varchar(63) DEFAULT NULL COMMENT '场次地址',
  `session_start_time` timestamp NULL DEFAULT NULL COMMENT '开始时间',
  `session_end_time` timestamp NULL DEFAULT NULL COMMENT '结束时间',
  `deleted` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=55 DEFAULT CHARSET=utf8mb4 COMMENT='活动场次表'