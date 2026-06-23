CREATE TABLE `study_abroad_attachment` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT COMMENT '自增ID',
  `business_id` bigint(20) DEFAULT NULL COMMENT '业务ID',
  `file_code` varchar(255) NOT NULL COMMENT '文件唯一编码',
  `file_name` varchar(255) DEFAULT NULL COMMENT '文件名',
  `type` int(11) NOT NULL COMMENT '0:网申个人信息附件 1:网申申请信息附件 2:offer附件 3:签证附件 4:文书附件',
  `del` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否被删除（0表示未删除，1表示已删除）',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=582 DEFAULT CHARSET=utf8mb4 COMMENT='留学附件表'