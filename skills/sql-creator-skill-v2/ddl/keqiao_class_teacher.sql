CREATE TABLE `keqiao_class_teacher` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `keqiao_class_id` bigint(11) NOT NULL COMMENT '班级ID',
  `admin_user_id` int(11) NOT NULL COMMENT '老师ID',
  PRIMARY KEY (`id`),
  KEY `keqiao_class_teacher_wj_1` (`keqiao_class_id`) USING BTREE,
  KEY `keqiao_class_teacher_wj_2` (`admin_user_id`) USING BTREE,
  CONSTRAINT `keqiao_class_teacher_ibfk_1` FOREIGN KEY (`keqiao_class_id`) REFERENCES `keqiao_class` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `keqiao_class_teacher_ibfk_2` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=1223 DEFAULT CHARSET=utf8mb4 COMMENT='班级老师'