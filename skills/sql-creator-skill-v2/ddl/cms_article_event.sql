CREATE TABLE `cms_article_event` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `article_id` bigint(11) NOT NULL COMMENT '活动id，关联到cms_article表的id',
  `event_name` varchar(255) NOT NULL COMMENT '专场名称',
  `event_poster_url` varchar(1024) DEFAULT NULL COMMENT '专场海报url',
  `deleted` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  PRIMARY KEY (`id`),
  KEY `article_id` (`article_id`) USING BTREE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='活动专场表'