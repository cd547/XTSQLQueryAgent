CREATE TABLE `order_approval_order_student_received_log` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `order_student_id` bigint(11) NOT NULL COMMENT '学生订单ID',
  `order_student_received_id` bigint(11) NOT NULL COMMENT '回款计划ID',
  `level` int(11) NOT NULL COMMENT '审批等级',
  `admin_user_id` int(11) NOT NULL COMMENT '审批人ID',
  `remarks` varchar(1024) DEFAULT NULL COMMENT '备注',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  `del` int(11) NOT NULL DEFAULT '0' COMMENT '是否删除',
  PRIMARY KEY (`id`),
  KEY `order_approval_log1` (`order_student_id`) USING BTREE,
  KEY `order_approval_log2` (`admin_user_id`) USING BTREE,
  KEY `order_approval_order_student_received_log_ibfk_3` (`order_student_received_id`) USING BTREE,
  CONSTRAINT `order_approval_order_student_received_log_ibfk_1` FOREIGN KEY (`order_student_id`) REFERENCES `order_student` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `order_approval_order_student_received_log_ibfk_2` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `order_approval_order_student_received_log_ibfk_3` FOREIGN KEY (`order_student_received_id`) REFERENCES `order_student_received` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=5909 DEFAULT CHARSET=utf8mb4 COMMENT='回款审批记录'