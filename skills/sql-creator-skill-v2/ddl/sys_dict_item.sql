CREATE TABLE `sys_dict_item` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT COMMENT 'ID主键',
  `dict_type` varchar(100) NOT NULL DEFAULT '' COMMENT '字典类型:GRADE',
  `business_type` tinyint(4) NOT NULL DEFAULT '0' COMMENT '业务类型: 0-默认， 1-留学',
  `code` int(11) NOT NULL DEFAULT '0' COMMENT 'code',
  `key` varchar(500) NOT NULL DEFAULT '' COMMENT 'key',
  `title` varchar(500) NOT NULL DEFAULT '' COMMENT '展示名称',
  `sort` int(11) NOT NULL DEFAULT '0' COMMENT '排序',
  `enable` tinyint(4) NOT NULL DEFAULT '1' COMMENT '启用：1-启用，0-未启用',
  `deleted` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_business_type_code` (`business_type`,`dict_type`,`code`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=173 DEFAULT CHARSET=utf8mb4 COMMENT='字典表'