CREATE TABLE `keqiao_time_table_section` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `keqiao_time_table_id` bigint(11) NOT NULL COMMENT '作息时间ID',
  `s_week` int(11) NOT NULL COMMENT '星期0~6',
  `s_time` int(11) NOT NULL COMMENT '时间段1上午2下午3晚上4午休',
  `s_sort` int(11) NOT NULL COMMENT '课节顺序',
  `is_work` int(11) NOT NULL DEFAULT '1' COMMENT '是否上课 1上课 2不上课',
  `s_name` varchar(255) NOT NULL COMMENT '课节名称',
  `s_start_time` bigint(20) NOT NULL COMMENT '课程开始时间',
  `s_end_time` bigint(20) NOT NULL COMMENT '课程结束时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `keqiao_time_table_section_sy_2` (`keqiao_time_table_id`,`s_week`,`s_sort`) USING BTREE,
  CONSTRAINT `keqiao_time_table_section_ibfk_1` FOREIGN KEY (`keqiao_time_table_id`) REFERENCES `keqiao_time_table` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=575 DEFAULT CHARSET=utf8mb4 COMMENT='作息时间课节'