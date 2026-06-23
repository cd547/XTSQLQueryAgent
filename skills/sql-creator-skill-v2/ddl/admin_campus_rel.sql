CREATE TABLE `admin_campus_rel` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键id',
  `admin_user_id` int(11) DEFAULT NULL COMMENT '员工ID',
  `campus_value` varchar(20) NOT NULL COMMENT '校区编码',
  `deleted` int(11) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  `create_by` int(11) DEFAULT NULL COMMENT '创建人',
  `update_by` int(11) DEFAULT NULL COMMENT '更新人',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_admin_user_id` (`admin_user_id`) USING BTREE,
  KEY `idx_campus_value` (`campus_value`) USING BTREE,
  KEY `idx_create_time` (`create_time`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=254 DEFAULT CHARSET=utf8mb4 COMMENT='员工-业务校区关系表'