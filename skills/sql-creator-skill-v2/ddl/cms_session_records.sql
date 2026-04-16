CREATE TABLE `cms_session_records` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT 'ID主键',
  `cms_article_id` int(10) unsigned NOT NULL COMMENT '关联活动ID',
  `session_id` int(11) DEFAULT NULL COMMENT '场次ID',
  `cms_apply_id` int(11) DEFAULT NULL COMMENT '活动报名ID',
  `my_user_id` int(11) unsigned DEFAULT NULL COMMENT '用户ID',
  `apply_mobile` varchar(15) DEFAULT NULL COMMENT '报名手机号',
  `signup_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '报名时间',
  `signin_time` timestamp NULL DEFAULT NULL COMMENT '签到时间',
  `record_status` tinyint(3) unsigned NOT NULL DEFAULT '0' COMMENT '状态（0: 已报名, 1: 已签到, 2: 已取消）',
  `deleted` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除 0 未删除 1 删除 默认是0',
  `create_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间，默认当前时间',
  `update_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间，默认当前时间',
  PRIMARY KEY (`id`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_update_time` (`update_time`),
  KEY `idx_apply_mobile` (`apply_mobile`)
) ENGINE=InnoDB AUTO_INCREMENT=3070 DEFAULT CHARSET=utf8mb4 COMMENT='活动场次报名记录表'