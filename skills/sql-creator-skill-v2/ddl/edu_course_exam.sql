CREATE TABLE `edu_course_exam` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `course_id` bigint(11) NOT NULL COMMENT '课程ID',
  `name` varchar(255) NOT NULL COMMENT '考试局名称',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `edu_course_id` (`course_id`) USING BTREE,
  CONSTRAINT `edu_course_id` FOREIGN KEY (`course_id`) REFERENCES `edu_course` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=561 DEFAULT CHARSET=utf8mb4 COMMENT='考试局(二级)'