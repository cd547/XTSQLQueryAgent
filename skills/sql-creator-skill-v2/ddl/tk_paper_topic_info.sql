CREATE TABLE `tk_paper_topic_info` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `topic_id` bigint(11) NOT NULL COMMENT '试题id',
  `type` int(1) DEFAULT '1' COMMENT '类型 1text 2img',
  `img_url` varchar(1024) DEFAULT NULL COMMENT '图片地址',
  `img_url_back` varchar(1024) DEFAULT NULL COMMENT '原始图片地址',
  `text_code` mediumtext COMMENT '代码片段',
  `sort` int(11) NOT NULL DEFAULT '1',
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `topic_id` (`topic_id`) USING BTREE,
  CONSTRAINT `tk_paper_topic_info_ibfk_1` FOREIGN KEY (`topic_id`) REFERENCES `tk_paper_topic` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=283594 DEFAULT CHARSET=utf8mb4 COMMENT='题干'