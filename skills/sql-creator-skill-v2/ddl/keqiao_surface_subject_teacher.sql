CREATE TABLE `keqiao_surface_subject_teacher` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `keqiao_surface_subject_id` bigint(11) NOT NULL COMMENT '课表课程ID',
  `admin_user_id` int(11) NOT NULL COMMENT '老师ID',
  PRIMARY KEY (`id`),
  KEY `keqiao_surface_subject_teacher1` (`keqiao_surface_subject_id`) USING BTREE,
  KEY `keqiao_surface_subject_teacher2` (`admin_user_id`) USING BTREE,
  CONSTRAINT `keqiao_surface_subject_teacher_ibfk_1` FOREIGN KEY (`keqiao_surface_subject_id`) REFERENCES `keqiao_surface_subject` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `keqiao_surface_subject_teacher_ibfk_2` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=8409 DEFAULT CHARSET=utf8mb4 COMMENT='课程-课表授课老师'