CREATE TABLE `auth_user_role` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT 'ID主键',
  `user_id` int(10) NOT NULL COMMENT '用户ID',
  `role_id` int(10) NOT NULL COMMENT '角色ID',
  `deleted` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `idx_role_user` (`user_id`,`deleted`,`role_id`) USING BTREE,
  KEY `idx_create_time` (`create_time`) USING BTREE,
  KEY `idx_update_time` (`update_time`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=248 DEFAULT CHARSET=utf8mb4 ROW_FORMAT=DYNAMIC COMMENT='用户角色信息表'