CREATE TABLE `study_abroad_document_materials` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `book_id` bigint(11) NOT NULL COMMENT '定校书id',
  `student_id` bigint(11) NOT NULL COMMENT '学生ID',
  `relevancy_id` bigint(11) DEFAULT NULL COMMENT '关联文书主表ID',
  `relevancy_attach_id` bigint(11) DEFAULT NULL COMMENT '关联文书附表ID',
  `status` int(11) NOT NULL DEFAULT '0' COMMENT '文书状态（0:未开始、1:初稿 2:定稿）',
  `remark` varchar(255) DEFAULT NULL COMMENT '备注',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COMMENT='留学文书材料表'