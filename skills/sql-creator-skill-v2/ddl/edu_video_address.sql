CREATE TABLE `edu_video_address` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `edu_video_id` bigint(11) NOT NULL COMMENT '视频ID',
  `original_url` varchar(1024) NOT NULL COMMENT '视频原始地址',
  `new_url` varchar(1024) DEFAULT NULL COMMENT '本站地址',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  `update_time` bigint(11) DEFAULT NULL COMMENT '视频完成下载到本地时间',
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `edu_video_address1` (`edu_video_id`) USING BTREE,
  CONSTRAINT `edu_video_address_ibfk_1` FOREIGN KEY (`edu_video_id`) REFERENCES `edu_video` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=170 DEFAULT CHARSET=utf8mb4 COMMENT='视频地址'