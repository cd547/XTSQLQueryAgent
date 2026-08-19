CREATE TABLE `edu_class_type` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `type` int(11) NOT NULL DEFAULT '1' COMMENT '类型',
  `useds` int(11) NOT NULL DEFAULT '1' COMMENT '常用标准1不常用2常用3定向包4储值类5班课类',
  `tag` varchar(50) DEFAULT NULL COMMENT '班型标签',
  `name` varchar(255) NOT NULL COMMENT '类型名称',
  `num` int(11) NOT NULL DEFAULT '1' COMMENT '最大人数',
  `discount` int(11) NOT NULL DEFAULT '100' COMMENT '折扣0-200整数',
  `can_studycancel` int(1) NOT NULL DEFAULT '1' COMMENT '是否可以请假：1：否，2：是',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  `is_auto_finish` int(1) NOT NULL DEFAULT '0' COMMENT '是否自动结课：0-否，1-是',
  `all_teachers` int(1) NOT NULL DEFAULT '0' COMMENT '应用所有老师：0-否，1-是',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=937 DEFAULT CHARSET=utf8mb4 COMMENT='班级类型'