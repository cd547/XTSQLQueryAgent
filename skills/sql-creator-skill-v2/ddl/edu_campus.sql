CREATE TABLE `edu_campus` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL COMMENT '校区名称',
  `simple` varchar(31) DEFAULT NULL,
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  `platform` int(11) NOT NULL DEFAULT '1' COMMENT '平台1学通2科桥',
  `manager_id` bigint(20) DEFAULT NULL COMMENT '校区负责人id',
  PRIMARY KEY (`id`),
  KEY `idx_simple` (`simple`)
) ENGINE=InnoDB AUTO_INCREMENT=393 DEFAULT CHARSET=utf8mb4 COMMENT='校区'