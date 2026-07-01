CREATE TABLE `my_user_openid` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `appid` varchar(128) NOT NULL COMMENT '微信appid',
  `my_user_id` bigint(11) NOT NULL COMMENT '用户id',
  `open_id` varchar(128) NOT NULL COMMENT 'openid',
  `created_time` varchar(128) NOT NULL,
  `update_time` varchar(128) NOT NULL,
  `identity_type` tinyint(4) DEFAULT '1' COMMENT '区分微信还是企业微信:1(默认):wechat_mp(公众号), 2.wecom_external(企业微信外部联系人)',
  PRIMARY KEY (`id`),
  KEY `openid_my_user_id` (`my_user_id`) USING BTREE,
  KEY `idx_open_id` (`open_id`),
  CONSTRAINT `my_user_openid_ibfk_1` FOREIGN KEY (`my_user_id`) REFERENCES `my_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=14543 DEFAULT CHARSET=utf8mb4 COMMENT='用户openid'