CREATE TABLE `order_approval_configure_user` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `order_approval_configure_id` bigint(11) NOT NULL COMMENT '流程ID',
  `level` int(11) NOT NULL COMMENT '审批等级',
  `admin_user_id` int(11) NOT NULL COMMENT '用户ID',
  PRIMARY KEY (`id`),
  KEY `order_approval_configure_user1` (`admin_user_id`) USING BTREE,
  KEY `order_approval_configure_user2` (`order_approval_configure_id`) USING BTREE,
  CONSTRAINT `order_approval_configure_user_ibfk_1` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `order_approval_configure_user_ibfk_2` FOREIGN KEY (`order_approval_configure_id`) REFERENCES `order_approval_configure` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=8278 DEFAULT CHARSET=utf8mb4 COMMENT='审批流程配置用户'