CREATE TABLE `edu_course_exam_subject_tag` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT COMMENT '标签ID',
  `name` varchar(128) NOT NULL COMMENT '标签名称',
  `admin_user_id` int(11) NOT NULL COMMENT '创建人',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  `update_time` bigint(11) NOT NULL COMMENT '更新时间',
  `del` int(11) NOT NULL COMMENT '标签状态 0-已启用；1-已禁用',
  PRIMARY KEY (`id`),
  KEY `edu_course_exam_subject_tag_wj1` (`admin_user_id`),
  CONSTRAINT `edu_course_exam_subject_tag_wj1` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=10899 DEFAULT CHARSET=utf8mb4 COMMENT='# 科目标签'