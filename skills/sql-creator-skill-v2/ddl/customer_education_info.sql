CREATE TABLE `customer_education_info` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键id',
  `customer_code` varchar(20) NOT NULL COMMENT '线索编码',
  `grade_value` int(11) DEFAULT NULL COMMENT '在读年级',
  `school_name` varchar(128) NOT NULL DEFAULT '' COMMENT '在读学校',
  `deleted` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  `create_by` int(11) DEFAULT NULL COMMENT '创建人',
  `update_by` int(11) DEFAULT NULL COMMENT '最后更新人',
  `old_flag` int(11) DEFAULT '0' COMMENT '是否是老数据(历销数据) 0-否 1-是',
  `crm_id` varchar(15) DEFAULT NULL COMMENT 'CRM系统业务主键',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_customer_code` (`customer_code`) USING BTREE,
  KEY `idx_school_name` (`school_name`)
) ENGINE=InnoDB AUTO_INCREMENT=109549 DEFAULT CHARSET=utf8mb4 COMMENT='线索教育信息表'