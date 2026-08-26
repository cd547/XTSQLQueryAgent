CREATE TABLE `t_exam_result_rule` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT 'ID主键',
  `subject_name_id` bigint(20) NOT NULL DEFAULT '0' COMMENT '四级科目 id',
  `admin_user_id` bigint(20) NOT NULL DEFAULT '0' COMMENT '创建人',
  `type` tinyint(4) NOT NULL DEFAULT '0' COMMENT '格式类型：1-字母，2-数字，3-百分比，4-自定义',
  `low_limit` varchar(100) NOT NULL DEFAULT '' COMMENT '下限',
  `up_limit` varchar(100) NOT NULL DEFAULT '' COMMENT '上限',
  `interval` decimal(10,2) DEFAULT NULL COMMENT '间隔：0.01',
  `mark` varchar(100) NOT NULL DEFAULT '' COMMENT '字母角标：-,+,*',
  `deleted` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  `places` tinyint(4) NOT NULL DEFAULT '0' COMMENT '小数位数：0-整数， 1-1位小数，2-2位小数',
  `letter_case` tinyint(4) NOT NULL DEFAULT '0' COMMENT '大小写：1-大写，2-小写，3-混合',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=2398 DEFAULT CHARSET=utf8mb4 COMMENT='成绩规则表'