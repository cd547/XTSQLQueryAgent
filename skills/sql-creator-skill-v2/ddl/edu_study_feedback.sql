CREATE TABLE `edu_study_feedback` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `edu_study_id` bigint(11) NOT NULL COMMENT '排课ID',
  `edu_study_feedback_type_id` bigint(11) NOT NULL COMMENT '考勤名称ID',
  `admin_user_id` int(11) DEFAULT NULL COMMENT '反馈人员ID',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  `remarks` varchar(2048) DEFAULT NULL COMMENT '备注',
  PRIMARY KEY (`id`),
  UNIQUE KEY `edu_study_feedback1` (`edu_study_id`) USING BTREE,
  KEY `edu_study_feedback2` (`edu_study_feedback_type_id`) USING BTREE,
  KEY `edu_study_feedback3` (`admin_user_id`) USING BTREE,
  CONSTRAINT `edu_study_feedback_ibfk_1` FOREIGN KEY (`edu_study_id`) REFERENCES `edu_study` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_study_feedback_ibfk_2` FOREIGN KEY (`edu_study_feedback_type_id`) REFERENCES `edu_study_feedback_type` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_study_feedback_ibfk_3` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=753 DEFAULT CHARSET=utf8mb4 COMMENT='排课老师考勤反馈'