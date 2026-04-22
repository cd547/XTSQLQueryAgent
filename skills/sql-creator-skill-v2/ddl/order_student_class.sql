CREATE TABLE `order_student_class` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `order_student_id` bigint(11) NOT NULL COMMENT '订单ID',
  `edu_course_exam_subject_name_id` bigint(11) NOT NULL COMMENT '科目名称ID',
  `class_hour` int(11) NOT NULL COMMENT '课时数',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `order_student_class1` (`order_student_id`) USING BTREE,
  KEY `order_student_class2` (`edu_course_exam_subject_name_id`) USING BTREE,
  CONSTRAINT `order_student_class_ibfk_1` FOREIGN KEY (`order_student_id`) REFERENCES `order_student` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `order_student_class_ibfk_2` FOREIGN KEY (`edu_course_exam_subject_name_id`) REFERENCES `edu_course_exam_subject_name` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=812 DEFAULT CHARSET=utf8mb4 COMMENT='订单关联科目'