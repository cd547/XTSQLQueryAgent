CREATE TABLE `order_contract_template` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `admin_division` int(11) DEFAULT NULL COMMENT 'admin_division',
  `type` int(11) NOT NULL COMMENT '模版类型1普通2补充协议',
  `series` int(11) NOT NULL COMMENT '模版所属系列1 善学2通达3 渊博4留学5升学',
  `name` varchar(255) NOT NULL COMMENT '模版名称',
  `path` varchar(2048) NOT NULL COMMENT '模版路径',
  `created_time` bigint(11) NOT NULL,
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `order_contract_template_wj_1` (`admin_division`) USING BTREE,
  CONSTRAINT `order_contract_template_ibfk_1` FOREIGN KEY (`admin_division`) REFERENCES `admin_division` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=22 DEFAULT CHARSET=utf8mb4 COMMENT='合同模版(datasy)'