CREATE TABLE `admin_character` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `type` int(11) NOT NULL DEFAULT '1' COMMENT '类型1普通2锁定不可编辑',
  `characterName` varchar(225) NOT NULL COMMENT '角色名称',
  `page_permission` varchar(4096) NOT NULL COMMENT '页面ID',
  `api_permission` varchar(2048) NOT NULL COMMENT '接口ID',
  `time` varchar(225) NOT NULL COMMENT '创建时间',
  `del` int(11) NOT NULL DEFAULT '0',
  `platform` int(11) NOT NULL DEFAULT '1' COMMENT '平台1学通2科桥',
  `org` int(4) NOT NULL DEFAULT '0' COMMENT '默认0学通，1科桥，2克勒',
  `is_system_reserved` tinyint(1) NOT NULL DEFAULT '0' COMMENT '系统保留，0不保留，1不可编辑不可见，用于同步',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1152 DEFAULT CHARSET=utf8 COMMENT='后台用户角色表'