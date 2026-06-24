CREATE TABLE `keqiao_surface_table` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `keqiao_surface_id` bigint(20) NOT NULL COMMENT '课表-总表ID',
  `keqiao_time_table_id` bigint(11) NOT NULL COMMENT '作息时间表ID',
  `s_week` int(11) NOT NULL COMMENT '星期0～6',
  `s_sort` int(11) NOT NULL COMMENT '课节',
  `keqiao_surface_subject_id` bigint(11) NOT NULL COMMENT '科目ID',
  PRIMARY KEY (`id`),
  KEY `keqiao_surface_table1` (`keqiao_time_table_id`) USING BTREE,
  KEY `keqiao_surface_table2` (`keqiao_surface_subject_id`) USING BTREE,
  KEY `keqiao_surface_table3` (`keqiao_surface_id`) USING BTREE,
  CONSTRAINT `keqiao_surface_table_ibfk_1` FOREIGN KEY (`keqiao_time_table_id`) REFERENCES `keqiao_time_table` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `keqiao_surface_table_ibfk_2` FOREIGN KEY (`keqiao_surface_subject_id`) REFERENCES `keqiao_surface_subject` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `keqiao_surface_table_ibfk_3` FOREIGN KEY (`keqiao_surface_id`) REFERENCES `keqiao_surface` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=42412 DEFAULT CHARSET=utf8mb4 COMMENT='课程-课表'