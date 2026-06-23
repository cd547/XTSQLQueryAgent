CREATE TABLE `study_abroad_major` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `major_category` varchar(255) NOT NULL COMMENT '专业大类',
  `sub_major` varchar(255) NOT NULL COMMENT '细分专业',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=47 DEFAULT CHARSET=utf8mb4 COMMENT='留学专业方向信息表'