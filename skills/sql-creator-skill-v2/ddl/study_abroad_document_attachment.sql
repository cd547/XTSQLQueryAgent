CREATE TABLE `study_abroad_document_attachment` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `business_id` bigint(20) NOT NULL COMMENT '业务ID',
  `document_type` int(11) DEFAULT NULL COMMENT '文书类型(1:PS 2:CV 3:RL 4:CommonEssay 5:US Essays 6:Other)',
  `remark` varchar(1024) DEFAULT NULL,
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=96 DEFAULT CHARSET=utf8mb4 COMMENT='留学文书类型表'