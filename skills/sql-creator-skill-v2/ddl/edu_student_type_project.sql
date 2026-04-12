CREATE TABLE `edu_student_type_project` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `edu_student_type_id` bigint(11) NOT NULL COMMENT '学生类型ID',
  `name` varchar(255) NOT NULL COMMENT '名称',
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `edu_student_type_project_wj_1` (`edu_student_type_id`) USING BTREE,
  CONSTRAINT `edu_student_type_project_wj_1` FOREIGN KEY (`edu_student_type_id`) REFERENCES `edu_student_type` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=28 DEFAULT CHARSET=utf8mb4 COMMENT='报读项目'