CREATE TABLE `my_user` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(128) DEFAULT '新用户' COMMENT '昵称',
  `mobile` varchar(128) DEFAULT NULL COMMENT '手机',
  `unionId` varchar(255) DEFAULT NULL COMMENT 'unionId',
  `avatar` varchar(1024) DEFAULT NULL COMMENT '头像',
  `remarks` varchar(1024) DEFAULT NULL COMMENT '学生备注',
  `contacts` varchar(128) DEFAULT NULL COMMENT '联系方式',
  `classin_id` varchar(128) DEFAULT NULL,
  `crm_id` varchar(128) DEFAULT NULL,
  `referrer` varchar(255) DEFAULT NULL COMMENT '推荐人',
  `register_open` varchar(255) DEFAULT NULL COMMENT '注册平台',
  `created_time` varchar(128) DEFAULT '0' COMMENT '创建时间',
  `update_time` varchar(128) DEFAULT NULL COMMENT '更新时间',
  `integral` bigint(255) NOT NULL DEFAULT '0' COMMENT '积分',
  `del` int(11) NOT NULL DEFAULT '0' COMMENT '删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unionid` (`unionId`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=17518 DEFAULT CHARSET=utf8 COMMENT='用户基本表'