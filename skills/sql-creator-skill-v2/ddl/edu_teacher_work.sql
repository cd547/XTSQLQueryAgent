CREATE TABLE `edu_teacher_work` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `admin_user_id` int(11) NOT NULL COMMENT '老师ID',
  `work_time` bigint(11) NOT NULL COMMENT '老师排班时间（时间戳）',
  `created_time` bigint(11) NOT NULL,
  `update_time` bigint(11) DEFAULT NULL,
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `edu_teacher_school1` (`admin_user_id`) USING BTREE,
  KEY `edu_teacher_school2` (`work_time`) USING BTREE,
  CONSTRAINT `edu_teacher_work_ibfk_1` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=2768616 DEFAULT CHARSET=utf8mb4 COMMENT='老师可排班时间'