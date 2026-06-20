CREATE TABLE `customer_label` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键id',
  `code` varchar(64) NOT NULL COMMENT '标签编码',
  `org` tinyint(2) DEFAULT NULL COMMENT '组织0-学通 1-科桥 2-科勒',
  `name` varchar(32) NOT NULL COMMENT '标签name',
  `deleted` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 ',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `create_by` int(11) DEFAULT NULL COMMENT '创建人',
  `update_by` int(11) DEFAULT NULL COMMENT '最后更新人',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `idx_code` (`code`) USING BTREE,
  KEY `idx_create_time` (`create_time`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=142 DEFAULT CHARSET=utf8mb4 COMMENT='线索标签表'