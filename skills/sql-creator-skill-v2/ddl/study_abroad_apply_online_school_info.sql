CREATE TABLE `study_abroad_apply_online_school_info` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `apply_online_info_id` bigint(20) NOT NULL COMMENT '网申信息主表ID',
  `school_sys_name` varchar(128) DEFAULT NULL COMMENT '学校系统名',
  `reference_number` varchar(128) DEFAULT NULL COMMENT '参考编号',
  `online_link` varchar(255) DEFAULT NULL COMMENT '网申链接',
  `apply_accnount` varchar(128) DEFAULT NULL COMMENT '申请账号',
  `apply_pwd` varchar(128) DEFAULT NULL COMMENT '申请密码',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=100 DEFAULT CHARSET=utf8mb4 COMMENT='留学网申信息学校信息'