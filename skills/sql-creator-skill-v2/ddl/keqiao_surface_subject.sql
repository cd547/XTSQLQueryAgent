CREATE TABLE `keqiao_surface_subject` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `keqiao_surface_id` bigint(11) NOT NULL COMMENT '课表-总表ID',
  `edu_course_exam_subject_name_id` bigint(11) NOT NULL COMMENT '科目名称ID',
  `week_num` int(11) NOT NULL COMMENT '周课时',
  `week_sd` int(11) NOT NULL DEFAULT '3' COMMENT '单双周排课 1单周 2双周 3全部',
  `edu_campus_school_class_id` bigint(255) NOT NULL COMMENT '上课教室ID',
  `keqiao_class_id` bigint(255) NOT NULL COMMENT '班级ID',
  `admin_user_id` int(11) NOT NULL COMMENT '操作人',
  PRIMARY KEY (`id`),
  KEY `keqiao_surface_subject1` (`edu_course_exam_subject_name_id`) USING BTREE,
  KEY `keqiao_surface_subject2` (`edu_campus_school_class_id`) USING BTREE,
  KEY `keqiao_surface_subject3` (`keqiao_class_id`) USING BTREE,
  KEY `keqiao_surface_subject4` (`keqiao_surface_id`) USING BTREE,
  CONSTRAINT `keqiao_surface_subject_ibfk_1` FOREIGN KEY (`edu_course_exam_subject_name_id`) REFERENCES `edu_course_exam_subject_name` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `keqiao_surface_subject_ibfk_2` FOREIGN KEY (`edu_campus_school_class_id`) REFERENCES `edu_campus_school_class` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `keqiao_surface_subject_ibfk_3` FOREIGN KEY (`keqiao_class_id`) REFERENCES `keqiao_class` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `keqiao_surface_subject_ibfk_4` FOREIGN KEY (`keqiao_surface_id`) REFERENCES `keqiao_surface` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=8765 DEFAULT CHARSET=utf8mb4 COMMENT='课程-科目'