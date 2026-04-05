CREATE TABLE `edu_course_exam_subject_name` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `subject_id` bigint(11) NOT NULL COMMENT '科目ID',
  `name` varchar(255) NOT NULL COMMENT '名称',
  `tk_knowledge_id` bigint(11) DEFAULT NULL COMMENT '知识点id(四级科目和知识点tk_knowledge做关联)，已经废弃',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  `rule_id` bigint(20) DEFAULT NULL COMMENT '成绩规则 id',
  PRIMARY KEY (`id`),
  KEY `edu_course_id` (`subject_id`) USING BTREE,
  KEY `edu_course_exam_subject_name_wj_2` (`tk_knowledge_id`),
  CONSTRAINT `edu_course_exam_subject_name_ibfk_1` FOREIGN KEY (`subject_id`) REFERENCES `edu_course_exam_subject` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_course_exam_subject_name_wj_2` FOREIGN KEY (`tk_knowledge_id`) REFERENCES `tk_knowledge` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=3252 DEFAULT CHARSET=utf8mb4 COMMENT='科目名称(四级)\n'