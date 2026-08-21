CREATE TABLE `order_approval_order_student_log` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `order_student_id` bigint(11) NOT NULL COMMENT '学生订单ID',
  `level` int(11) NOT NULL COMMENT '审批等级',
  `admin_user_id` int(11) NOT NULL COMMENT '审批人ID',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  `remarks` varchar(1024) DEFAULT NULL COMMENT '备注',
  `del` int(11) NOT NULL DEFAULT '0' COMMENT '是否删除',
  PRIMARY KEY (`id`),
  KEY `order_approval_log1` (`order_student_id`) USING BTREE,
  KEY `order_approval_log2` (`admin_user_id`) USING BTREE,
  CONSTRAINT `order_approval_order_student_log_ibfk_1` FOREIGN KEY (`order_student_id`) REFERENCES `order_student` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `order_approval_order_student_log_ibfk_2` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=8108 DEFAULT CHARSET=utf8mb4 COMMENT='订单审批记录'