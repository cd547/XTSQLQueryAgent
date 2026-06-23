CREATE TABLE `abroad_standard_field` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键id',
  `name` varchar(64) NOT NULL DEFAULT '' COMMENT '名称',
  `code` varchar(64) DEFAULT NULL COMMENT '字段编码',
  `source` int(11) DEFAULT NULL COMMENT '标准字段来源:0-学员管理规划信息列表 1-留学管理待分配列表 2-留学管理全部学生列表 3-留学管理我的学生列表',
  `is_fixed` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否是固定字段 0-否  1-是',
  `deleted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  `create_by` int(11) DEFAULT NULL COMMENT '创建人',
  `update_by` int(11) DEFAULT NULL COMMENT '最后更新人',
  `sort_no` int(11) NOT NULL DEFAULT '9999' COMMENT '排序字段',
  PRIMARY KEY (`id`) USING BTREE,
  KEY `idx_code` (`code`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=123 DEFAULT CHARSET=utf8mb4 COMMENT='自定义标准字段表'