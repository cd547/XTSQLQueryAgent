CREATE TABLE `edu_course_exam_module` (
  `id` int(11) unsigned NOT NULL AUTO_INCREMENT COMMENT 'ID主键',
  `subject_name_id` varchar(64) NOT NULL COMMENT '科目名称(四级)ID',
  `module_name` varchar(64) NOT NULL COMMENT '五级模块名称',
  `deleted` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  `achievement_type` tinyint(4) NOT NULL DEFAULT '0' COMMENT '成绩规则：默认0：无规则，自定义;1：1-9;2:A*/A/B/C/D/E/U/no result\na/b/c/d/e/u',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`),
  KEY `idx_subject_name_id` (`subject_name_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1810 DEFAULT CHARSET=utf8mb4 COMMENT='五级模块'