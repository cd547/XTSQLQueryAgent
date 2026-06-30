CREATE TABLE `edu_activities_student` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `edu_activities_id` bigint(11) NOT NULL COMMENT '课外活动ID',
  `edu_student_id` bigint(11) NOT NULL COMMENT '学生ID',
  `admin_user_id` int(11) NOT NULL COMMENT '操作人ID',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `edu_activities_student_1` (`edu_activities_id`) USING BTREE,
  KEY `edu_activities_student_2` (`edu_student_id`) USING BTREE,
  KEY `edu_activities_student_3` (`admin_user_id`) USING BTREE,
  CONSTRAINT `edu_activities_student_ibfk_1` FOREIGN KEY (`edu_activities_id`) REFERENCES `edu_activities` (`id`) ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT `edu_activities_student_ibfk_2` FOREIGN KEY (`edu_student_id`) REFERENCES `edu_student` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_activities_student_ibfk_3` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=1201 DEFAULT CHARSET=utf8mb4 COMMENT='课外活动学生关联表'