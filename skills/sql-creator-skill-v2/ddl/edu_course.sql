CREATE TABLE `edu_course` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `platform` int(11) NOT NULL DEFAULT '1' COMMENT '平台1学通2科桥',
  `name` varchar(255) NOT NULL COMMENT '课程名称',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  `org` int(4) NOT NULL DEFAULT '0' COMMENT '默认0学通，1科桥，2克勒',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=418 DEFAULT CHARSET=utf8mb4 COMMENT='课程(一级)'