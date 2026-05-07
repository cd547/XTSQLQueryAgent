CREATE TABLE `keqiao_class_student` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `keqiao_class_id` bigint(11) NOT NULL,
  `edu_student_id` bigint(11) NOT NULL,
  `created_time` bigint(11) NOT NULL,
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `keqiao_class_student_wj_1` (`keqiao_class_id`) USING BTREE,
  KEY `keqiao_class_student_wj_2` (`edu_student_id`) USING BTREE,
  CONSTRAINT `keqiao_class_student_ibfk_1` FOREIGN KEY (`keqiao_class_id`) REFERENCES `keqiao_class` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `keqiao_class_student_ibfk_2` FOREIGN KEY (`edu_student_id`) REFERENCES `edu_student` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=7443 DEFAULT CHARSET=utf8mb4 COMMENT='学生班级关系'