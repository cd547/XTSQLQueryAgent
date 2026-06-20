CREATE TABLE `edu_campus_school_class` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `type` int(11) NOT NULL DEFAULT '1' COMMENT '类型1普通 2锁定不可修改 可重复选',
  `campus_school_id` bigint(11) NOT NULL COMMENT '分校id',
  `name` varchar(255) NOT NULL COMMENT '班级名称',
  `num` int(11) NOT NULL COMMENT '最大学生数量',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `edu_campus_school_class_fxid1` (`campus_school_id`) USING BTREE,
  KEY `idx_campus_school_del` (`campus_school_id`,`del`),
  CONSTRAINT `edu_campus_school_class_ibfk_1` FOREIGN KEY (`campus_school_id`) REFERENCES `edu_campus_school` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=4897 DEFAULT CHARSET=utf8mb4 COMMENT='教室'