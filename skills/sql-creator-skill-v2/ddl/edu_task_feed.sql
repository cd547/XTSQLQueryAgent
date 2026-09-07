CREATE TABLE `edu_task_feed` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `feed_teacher_id` bigint(11) DEFAULT NULL COMMENT '反馈ID',
  `task_id` bigint(11) DEFAULT NULL COMMENT '作业ID',
  `num` int(11) NOT NULL DEFAULT '-1' COMMENT '评分-1 未填 ',
  `content` mediumtext NOT NULL COMMENT '反馈内容',
  `remarks` varchar(1024) DEFAULT NULL COMMENT '备注',
  `created_time` bigint(11) NOT NULL,
  `update_time` bigint(11) NOT NULL,
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `edu_task1` (`task_id`) USING BTREE,
  KEY `edu_task_feed_ibfk_2` (`feed_teacher_id`) USING BTREE,
  CONSTRAINT `edu_task_feed_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `edu_task` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_task_feed_ibfk_2` FOREIGN KEY (`feed_teacher_id`) REFERENCES `edu_feed_teacher` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=13145 DEFAULT CHARSET=utf8mb4 COMMENT='作业反馈'