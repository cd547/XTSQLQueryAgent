CREATE TABLE `tk_paper_topic_parsing` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `topic_id` bigint(11) NOT NULL COMMENT '题目ID，关联tk_paper_topic.id',
  `parsing_type` int(11) NOT NULL DEFAULT '1' COMMENT '解析类型：1-文本/代码，2-图片',
  `parsing` varchar(1024) DEFAULT NULL COMMENT '解析',
  `parsing_img` varchar(1024) DEFAULT NULL COMMENT '解析图片URL',
  `parsing_img_back` varchar(1024) DEFAULT NULL COMMENT '解析图片备份URL',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  `deleted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '删除标记：0-未删除，1-已删除',
  PRIMARY KEY (`id`),
  KEY `idx_topic_id` (`topic_id`),
  KEY `idx_deleted` (`deleted`)
) ENGINE=InnoDB AUTO_INCREMENT=1130 DEFAULT CHARSET=utf8mb4 COMMENT='试题解析表'