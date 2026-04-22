CREATE TABLE `edu_course_exam_subject_name_price_list` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `price_id` bigint(11) NOT NULL COMMENT '标准单价表ID',
  `subject_name_id` bigint(11) NOT NULL COMMENT '科目名称ID',
  `amount` int(11) NOT NULL COMMENT '金额（精确到分）',
  `minutes` int(11) NOT NULL COMMENT '一课时分钟数',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `price_campus_id` bigint(11) DEFAULT NULL COMMENT '标准单价校区表id',
  PRIMARY KEY (`id`),
  KEY `edu_course_exam_subject_name_price_list_ibfk_1` (`price_id`) USING BTREE,
  KEY `edu_course_exam_subject_name_price_list_ibfk_2` (`subject_name_id`) USING BTREE,
  CONSTRAINT `edu_course_exam_subject_name_price_list_ibfk_1` FOREIGN KEY (`price_id`) REFERENCES `edu_course_exam_subject_name_price` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_course_exam_subject_name_price_list_ibfk_2` FOREIGN KEY (`subject_name_id`) REFERENCES `edu_course_exam_subject_name` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=98860 DEFAULT CHARSET=utf8mb4 COMMENT='科目名称标准单价详细信息'