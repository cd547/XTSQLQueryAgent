CREATE TABLE `study_abroad_school` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `country` varchar(255) DEFAULT NULL COMMENT '国家',
  `school_ch_name` varchar(255) DEFAULT NULL COMMENT '学校中文名',
  `school_en_name` varchar(255) DEFAULT NULL COMMENT '学校英文名',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=66 DEFAULT CHARSET=utf8mb4 COMMENT='留学学校信息表'