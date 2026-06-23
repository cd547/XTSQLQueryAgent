CREATE TABLE `study_abroad_operate_log` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `module_type` varchar(50) NOT NULL COMMENT '模块类型(DOCUMENT_MANAGE:文书管理, DOCUMENT:文书材料, NET_APPLY:网申信息, OFFER:offer, VISA:签证)',
  `business_id` bigint(20) DEFAULT NULL COMMENT '业务数据ID(如网申信息ID、文书材料ID等)',
  `operation_type` varchar(20) NOT NULL COMMENT '操作类型(INSERT:新增, UPDATE:更新, DELETE:删除)',
  `operation_desc` json DEFAULT NULL COMMENT '操作描述',
  `operator_id` bigint(20) NOT NULL COMMENT '操作人ID',
  `operation_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_module_business` (`module_type`,`business_id`),
  KEY `idx_operation_time` (`operation_time`)
) ENGINE=InnoDB AUTO_INCREMENT=534 DEFAULT CHARSET=utf8mb4 COMMENT='操作记录主表'