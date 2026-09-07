CREATE TABLE `edu_teacher_class_subject_name` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `admin_user_id` int(11) NOT NULL COMMENT '老师ID',
  `subject_name_id` bigint(11) NOT NULL COMMENT '科目名称id',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `edu_teacher_school1` (`admin_user_id`) USING BTREE,
  KEY `edu_teacher_class_type_ibfk_2` (`subject_name_id`) USING BTREE,
  CONSTRAINT `edu_teacher_class_subject_name_ibfk_1` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_teacher_class_subject_name_ibfk_2` FOREIGN KEY (`subject_name_id`) REFERENCES `edu_course_exam_subject_name` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=794468 DEFAULT CHARSET=utf8mb4 COMMENT='老师可教科目名称'