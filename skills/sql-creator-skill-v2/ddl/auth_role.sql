CREATE TABLE `auth_role` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT 'ID主键',
  `role_name` varchar(31) NOT NULL DEFAULT '' COMMENT '角色名称',
  `deleted` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  `system_type` tinyint(4) DEFAULT NULL COMMENT '系统类型',
  `org` tinyint(4) NOT NULL DEFAULT '0' COMMENT '所属机构',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uk_role` (`role_name`,`system_type`,`org`,`deleted`),
  KEY `idx_create_time` (`create_time`) USING BTREE,
  KEY `idx_update_time` (`update_time`) USING BTREE,
  KEY `idx_system_org` (`system_type`,`org`,`deleted`)
) ENGINE=InnoDB AUTO_INCREMENT=47 DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC COMMENT='角色信息表'