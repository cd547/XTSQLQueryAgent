CREATE TABLE `study_abroad_school_selection_detail` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `school_selection_id` bigint(20) NOT NULL COMMENT 'study_abroad_school_selection表主键ID',
  `book_id` bigint(20) NOT NULL COMMENT 'study_abroad_proofread_book表主键ID',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `custom_options` varchar(100) DEFAULT NULL COMMENT '定校书自定义title选项,多个用逗号分隔',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=283 DEFAULT CHARSET=utf8mb4 COMMENT='留学生成定校书pdf明细表'