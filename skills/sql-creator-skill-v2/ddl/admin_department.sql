CREATE TABLE `admin_department` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `platform` int(11) NOT NULL DEFAULT '1' COMMENT '平台1学通2(科桥克勒)',
  `name` varchar(255) NOT NULL COMMENT '一级部门名称',
  `sort` int(11) NOT NULL DEFAULT '1000' COMMENT '排序',
  `del` int(11) NOT NULL DEFAULT '0',
  `org` int(4) NOT NULL DEFAULT '0' COMMENT '默认0学通，1科桥，2克勒',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=106 DEFAULT CHARSET=utf8mb4 COMMENT='一级部门'