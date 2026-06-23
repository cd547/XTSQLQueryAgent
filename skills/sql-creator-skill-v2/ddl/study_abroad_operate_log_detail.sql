CREATE TABLE `study_abroad_operate_log_detail` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `log_id` bigint(20) NOT NULL COMMENT '操作记录主表ID',
  `field_name` varchar(100) NOT NULL COMMENT '字段名称',
  `old_value` text COMMENT '原始值',
  `new_value` text COMMENT '新值',
  `change_type` varchar(20) NOT NULL COMMENT '变更类型(ADD:新增字段, UPDATE:更新字段, DELETE:删除字段)',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作记录详情表'