CREATE TABLE `order_approval_configure` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `type` int(11) NOT NULL COMMENT '类型1订单审批2回款审批3订单高级审批4订单默认审批5订单高级默认审批6回款默认审批',
  `edu_campus_id` bigint(11) DEFAULT NULL COMMENT '校区ID',
  `order_entry_id` bigint(11) DEFAULT NULL COMMENT '项目名称ID',
  PRIMARY KEY (`id`),
  KEY `order_approval_configure1` (`edu_campus_id`) USING BTREE,
  KEY `order_approval_configure2` (`order_entry_id`) USING BTREE,
  CONSTRAINT `order_approval_configure_ibfk_1` FOREIGN KEY (`edu_campus_id`) REFERENCES `edu_campus` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `order_approval_configure_ibfk_2` FOREIGN KEY (`order_entry_id`) REFERENCES `order_entry` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=115 DEFAULT CHARSET=utf8mb4 COMMENT='审批流程配置'