CREATE TABLE `tk_knowledge_new` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `parent_id` bigint(11) NOT NULL DEFAULT '1' COMMENT '父级id',
  `title` varchar(255) NOT NULL COMMENT '知识点标题',
  `resolve` varchar(1024) DEFAULT NULL COMMENT '知识点解析',
  `video_url` varchar(1024) DEFAULT NULL COMMENT '视频url',
  `audio_url` varchar(1024) DEFAULT NULL COMMENT '音频url',
  `img_url` varchar(1024) DEFAULT NULL COMMENT '图片url',
  `admin_user_id` bigint(11) NOT NULL COMMENT '操作人id',
  `create_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `rel` int(1) NOT NULL DEFAULT '1' COMMENT '是否发布0未发布 1已发布',
  `deleted` int(1) NOT NULL DEFAULT '0',
  `rel_new` tinyint(4) NOT NULL DEFAULT '1' COMMENT '1-上线，0-下线',
  PRIMARY KEY (`id`),
  KEY `tk_knowledge_new_parent_id` (`parent_id`) USING BTREE,
  KEY `tk_knowledge_new_admin_user_id` (`admin_user_id`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=14697 DEFAULT CHARSET=utf8mb4 COMMENT='知识点库（2025新版）'