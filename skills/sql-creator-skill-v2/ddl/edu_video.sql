CREATE TABLE `edu_video` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `type` int(11) NOT NULL COMMENT '类型：1 classin 2其他',
  `edu_study_id` bigint(11) DEFAULT NULL COMMENT '排课ID',
  `name` varchar(255) DEFAULT NULL COMMENT '视频名称',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `edu_video1` (`edu_study_id`) USING BTREE,
  CONSTRAINT `edu_video_ibfk_1` FOREIGN KEY (`edu_study_id`) REFERENCES `edu_study` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=75 DEFAULT CHARSET=utf8mb4 COMMENT='视频表'