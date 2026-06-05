CREATE TABLE `order_student_received_settlement_log` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `admin_channel_settlement_id` bigint(11) NOT NULL COMMENT '佣金结算表ID',
  `remarks` varchar(1024) NOT NULL COMMENT '操作人修改的记录',
  `admin_user_id` int(11) NOT NULL COMMENT '操作人后台用户ID',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间（时间戳）',
  `del` int(11) NOT NULL DEFAULT '0' COMMENT '0-正常；1-删除',
  PRIMARY KEY (`id`),
  KEY `admin_channel_settlement_log_wj_2` (`admin_user_id`),
  KEY `admin_channel_settlement_log_wj_1` (`admin_channel_settlement_id`),
  CONSTRAINT `admin_channel_settlement_log_wj_1` FOREIGN KEY (`admin_channel_settlement_id`) REFERENCES `order_student_received_settlement` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `admin_channel_settlement_log_wj_2` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=216 DEFAULT CHARSET=utf8mb4 COMMENT='回款计划-佣金结算金额修改记录表'