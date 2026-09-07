CREATE TABLE `edu_teacher_school` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `admin_user_id` int(11) NOT NULL COMMENT '老师ID',
  `school_id` bigint(11) NOT NULL COMMENT '分校id',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `edu_teacher_school1` (`admin_user_id`) USING BTREE,
  KEY `edu_teacher_school2` (`school_id`) USING BTREE,
  CONSTRAINT `edu_teacher_school_ibfk_1` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_teacher_school_ibfk_2` FOREIGN KEY (`school_id`) REFERENCES `edu_campus_school` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=26561 DEFAULT CHARSET=utf8mb4 COMMENT='老师所属校区'