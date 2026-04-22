CREATE TABLE `edu_course_exam_subject_name_price` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL COMMENT '标准单价名称',
  `admin_user_id` int(11) NOT NULL COMMENT '操作人ID',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  `use_status` tinyint(4) DEFAULT '0' COMMENT '使用状态：0-禁用、1-启用',
  PRIMARY KEY (`id`),
  KEY `admin_user_id_assistant` (`admin_user_id`) USING BTREE,
  CONSTRAINT `edu_course_exam_subject_name_price1` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=106 DEFAULT CHARSET=utf8mb4 COMMENT='科目名称标准单价'