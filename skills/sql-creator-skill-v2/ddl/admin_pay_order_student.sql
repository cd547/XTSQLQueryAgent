CREATE TABLE `admin_pay_order_student` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `admin_pay_order_id` bigint(11) NOT NULL COMMENT '支付单ID',
  `order_student_id` bigint(11) NOT NULL COMMENT '订单ID',
  PRIMARY KEY (`id`),
  KEY `admin_pay_order_student_wj_1` (`admin_pay_order_id`) USING BTREE,
  KEY `admin_pay_order_student_wj_2` (`order_student_id`) USING BTREE,
  CONSTRAINT `admin_pay_order_student_ibfk_1` FOREIGN KEY (`admin_pay_order_id`) REFERENCES `admin_pay_order` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `admin_pay_order_student_ibfk_2` FOREIGN KEY (`order_student_id`) REFERENCES `order_student` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=1287 DEFAULT CHARSET=utf8mb4 COMMENT='支付单—关联学生订单表'