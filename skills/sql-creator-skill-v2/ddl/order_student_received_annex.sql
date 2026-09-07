CREATE TABLE `order_student_received_annex` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `order_student_received_id` bigint(11) NOT NULL COMMENT '回款计划ID',
  `url` varchar(255) NOT NULL COMMENT '附件URL',
  `created_time` bigint(20) NOT NULL COMMENT '创建时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10770 DEFAULT CHARSET=utf8mb4 COMMENT='回款附件'