CREATE TABLE `edu_study_student` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `edu_study_id` bigint(11) NOT NULL COMMENT '排课ID',
  `edu_student_id` bigint(11) NOT NULL COMMENT '学生ID',
  `admin_user_id` int(11) NOT NULL COMMENT '操作人ID',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  `teaching_status` int(11) NOT NULL DEFAULT '0' COMMENT '授课状态:-1-失败 0-未确定 1-成功 ',
  PRIMARY KEY (`id`),
  KEY `edu_study_student1` (`edu_study_id`) USING BTREE,
  KEY `edu_study_student2` (`edu_student_id`) USING BTREE,
  KEY `edu_study_student3` (`admin_user_id`) USING BTREE,
  CONSTRAINT `edu_study_student_ibfk_1` FOREIGN KEY (`edu_study_id`) REFERENCES `edu_study` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_study_student_ibfk_2` FOREIGN KEY (`edu_student_id`) REFERENCES `edu_student` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_study_student_ibfk_3` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=92604 DEFAULT CHARSET=utf8mb4 COMMENT='排课学生关联表'