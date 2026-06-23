CREATE TABLE `study_abroad_case_closure` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `student_id` bigint(11) NOT NULL COMMENT '学生ID',
  `case_closure_status` int(11) NOT NULL DEFAULT '0' COMMENT '结案状态：0-未结案、1-已结案',
  `document_status` int(11) NOT NULL DEFAULT '1' COMMENT '有无文书服务： 0:无文书服务 1有文书服务',
  `plan_service_staus` int(11) NOT NULL DEFAULT '1' COMMENT '规划服务状态； 0:无规划服务 1有规划服务 ',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=65 DEFAULT CHARSET=utf8mb4 COMMENT='留学结案表'