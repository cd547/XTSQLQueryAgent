CREATE TABLE `keqiao_class_grade` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `keqiao_class_id` bigint(11) NOT NULL COMMENT '班级ID',
  `keqiao_grade_id` bigint(11) NOT NULL COMMENT '科桥年级ID',
  PRIMARY KEY (`id`),
  KEY `keqiao_class_grade_wj_1` (`keqiao_class_id`) USING BTREE,
  KEY `keqiao_class_grade_wj_2` (`keqiao_grade_id`) USING BTREE,
  CONSTRAINT `keqiao_class_grade_ibfk_1` FOREIGN KEY (`keqiao_class_id`) REFERENCES `keqiao_class` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `keqiao_class_grade_ibfk_2` FOREIGN KEY (`keqiao_grade_id`) REFERENCES `keqiao_grade` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=13647 DEFAULT CHARSET=utf8mb4 COMMENT='班级年级'