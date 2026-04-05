CREATE TABLE `edu_course_exam_subject` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `exam_id` bigint(11) NOT NULL COMMENT '考试局ID',
  `edu_course_exam_subject_tag_id` bigint(11) DEFAULT NULL COMMENT '科目标签ID',
  `name` varchar(255) NOT NULL COMMENT '科目名称',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(11) NOT NULL DEFAULT '0',
  `rel` int(11) NOT NULL DEFAULT '0',
  `score` bigint(11) DEFAULT NULL COMMENT '三级科目对应的学分',
  PRIMARY KEY (`id`),
  KEY `edu_course_id` (`exam_id`) USING BTREE,
  KEY `edu_course_exam_subject_ibfk_2` (`edu_course_exam_subject_tag_id`),
  KEY `edu_exam_subject_ibfk_2` (`edu_course_exam_subject_tag_id`) USING BTREE,
  CONSTRAINT `edu_exam_subject_ibfk_1` FOREIGN KEY (`exam_id`) REFERENCES `edu_course_exam` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_exam_subject_ibfk_2` FOREIGN KEY (`edu_course_exam_subject_tag_id`) REFERENCES `edu_course_exam_subject_tag` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=1133 DEFAULT CHARSET=utf8mb4 COMMENT='科目（三级）'