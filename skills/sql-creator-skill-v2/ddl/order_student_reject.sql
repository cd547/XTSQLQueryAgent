CREATE TABLE `order_student_reject` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `order_student_id` bigint(11) NOT NULL COMMENT '订单ID',
  `admin_user_id` int(11) DEFAULT NULL COMMENT '审批人ID',
  `level` int(11) DEFAULT NULL COMMENT '审批等级',
  `remarks` varchar(1024) NOT NULL COMMENT '备注',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `order_student_reject1` (`order_student_id`) USING BTREE,
  KEY `order_student_reject_ibfk_2_idx` (`admin_user_id`),
  CONSTRAINT `order_student_reject_ibfk_1` FOREIGN KEY (`order_student_id`) REFERENCES `order_student` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `order_student_reject_ibfk_2` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=1567 DEFAULT CHARSET=utf8mb4 COMMENT='订单驳回记录'