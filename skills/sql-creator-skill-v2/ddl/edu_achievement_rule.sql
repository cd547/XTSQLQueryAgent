CREATE TABLE `edu_achievement_rule` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `achievement_type` tinyint(4) NOT NULL COMMENT '成绩规则默认0：无规则自定义。1：1-9。2：A*/A/B/C/D/E/U/no result\r\na/b/c/d/e/u',
  `subject_name_id` int(11) NOT NULL COMMENT '科目名称(四级)ID',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1410 DEFAULT CHARSET=utf8mb4 COMMENT='测试成绩-规则'