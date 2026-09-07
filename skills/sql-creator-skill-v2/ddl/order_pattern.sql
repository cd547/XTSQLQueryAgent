CREATE TABLE `order_pattern` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `admin_division` int(11) DEFAULT NULL COMMENT '事业部admin_division',
  `type` int(11) NOT NULL DEFAULT '2' COMMENT '类型1为扣课订单2为普通订单',
  `contract_type` int(11) NOT NULL DEFAULT '1' COMMENT '合同类型：1合同2收据',
  `name` varchar(255) NOT NULL,
  `include_calc` int(11) NOT NULL DEFAULT '0' COMMENT '是否纳入渠道佣金结算统计',
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `order_pattern_wj_1` (`admin_division`) USING BTREE,
  CONSTRAINT `order_pattern_ibfk_1` FOREIGN KEY (`admin_division`) REFERENCES `admin_division` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=17 DEFAULT CHARSET=utf8mb4 COMMENT='订单模式'