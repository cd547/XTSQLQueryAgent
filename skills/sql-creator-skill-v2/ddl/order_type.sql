CREATE TABLE `order_type` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `del` int(11) NOT NULL DEFAULT '0',
  `admin_division` int(11) NOT NULL,
  `def_val` int(11) NOT NULL DEFAULT '0' COMMENT '默认值 1为默认 0为非默认值 每个事业部唯一 ',
  PRIMARY KEY (`id`),
  KEY `order_type_wj_1` (`admin_division`) USING BTREE,
  CONSTRAINT `order_type_wj_1` FOREIGN KEY (`admin_division`) REFERENCES `admin_division` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COMMENT='订单类型'