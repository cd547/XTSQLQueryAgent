CREATE TABLE `order_student_received_reject` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `order_student_received_id` bigint(11) NOT NULL COMMENT '回款计划ID',
  `remarks` varchar(1024) NOT NULL COMMENT '备注',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  `admin_user_id` int(11) DEFAULT NULL COMMENT '驳回人',
  `deleted` tinyint(1) unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `order_student_received_reject1` (`order_student_received_id`) USING BTREE,
  CONSTRAINT `order_student_received_reject_ibfk_1` FOREIGN KEY (`order_student_received_id`) REFERENCES `order_student_received` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=598 DEFAULT CHARSET=utf8mb4 COMMENT='回款计划驳回记录'