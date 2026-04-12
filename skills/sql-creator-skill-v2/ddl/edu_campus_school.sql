CREATE TABLE `edu_campus_school` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `campus_id` bigint(11) NOT NULL COMMENT '校区ID',
  `name` varchar(255) NOT NULL COMMENT '分校名称',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `edu_campus_school_xqid1` (`campus_id`) USING BTREE,
  CONSTRAINT `edu_campus_school_xqid1` FOREIGN KEY (`campus_id`) REFERENCES `edu_campus` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=160 DEFAULT CHARSET=utf8mb4 COMMENT='分校'