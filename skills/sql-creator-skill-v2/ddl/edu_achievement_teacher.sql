CREATE TABLE `edu_achievement_teacher` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `edu_achievement_id` bigint(11) NOT NULL,
  `admin_user_id` int(11) NOT NULL COMMENT '任课老师',
  PRIMARY KEY (`id`),
  KEY `edu_achievement_teacher_wj_1` (`edu_achievement_id`) USING BTREE,
  KEY `edu_achievement_teacher_wj_2` (`admin_user_id`) USING BTREE,
  CONSTRAINT `edu_achievement_teacher_ibfk_1` FOREIGN KEY (`edu_achievement_id`) REFERENCES `edu_achievement` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_achievement_teacher_ibfk_2` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=11995 DEFAULT CHARSET=utf8mb4 COMMENT='测试成绩-任课老师'