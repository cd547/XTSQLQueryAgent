CREATE TABLE `goods_list` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT COMMENT '商品ID',
  `name` varchar(128) NOT NULL COMMENT '商品名称',
  `type` int(11) NOT NULL DEFAULT '1' COMMENT '商品类型：1实物商品 2虚拟商品',
  `goods_img` varchar(128) DEFAULT NULL COMMENT '商品图片',
  `introduce` varchar(128) DEFAULT NULL COMMENT '商品介绍',
  `monovalent` decimal(11,0) NOT NULL COMMENT '商品单价',
  `monovalent_primary` decimal(11,0) NOT NULL COMMENT '商品原价',
  `monovalent_event` decimal(11,0) NOT NULL COMMENT '活动价',
  `amount` int(11) NOT NULL DEFAULT '1' COMMENT '数量',
  `remarks` varchar(1024) DEFAULT NULL COMMENT '备注',
  `is_auto` int(11) NOT NULL DEFAULT '1' COMMENT '是否手动添加1手动2自动',
  `rel` int(11) NOT NULL DEFAULT '1' COMMENT '0未发布 1已发布',
  `del` int(11) NOT NULL DEFAULT '0',
  `operator` varchar(255) DEFAULT NULL COMMENT '操作人',
  `created_time` bigint(128) NOT NULL,
  `update_time` bigint(128) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=218009 DEFAULT CHARSET=utf8 COMMENT='商品表'