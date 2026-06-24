CREATE TABLE `keqiao_time_table` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL COMMENT '时间表名称',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  `del` int(11) NOT NULL DEFAULT '0',
  `org` tinyint(4) NOT NULL DEFAULT '1' COMMENT '1: 科桥; 2: 克勒',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COMMENT='作息时间'