CREATE TABLE `crm_target_school` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '目标学校ID主键',
  `logo_file_code` varchar(255) NOT NULL COMMENT '学校校徽文件编码，对应现有下载中心文件',
  `name_zh` varchar(100) NOT NULL COMMENT '目标学校中文全称，业务层限制最多30个字符',
  `name_en` varchar(200) NOT NULL COMMENT '目标学校英文全称，业务层限制最多100个字符',
  `country_region` varchar(100) NOT NULL COMMENT '所属国家/地区编码，对应sys_dict_item.key',
  `qs_ranking` int(11) DEFAULT NULL COMMENT 'QS排名；无排名时为空',
  `publish_status` varchar(20) NOT NULL DEFAULT '1' COMMENT '发布状态编码：1-已发布，0-未发布',
  `version` int(11) NOT NULL DEFAULT '0' COMMENT '乐观锁版本号',
  `del` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除：0-未删除，1-已删除',
  `created_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_target_school_name_zh` (`name_zh`),
  UNIQUE KEY `uk_target_school_name_en` (`name_en`(100)),
  KEY `idx_target_school_country` (`country_region`),
  KEY `idx_target_school_status` (`publish_status`),
  KEY `idx_target_school_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=308 DEFAULT CHARSET=utf8mb4 COMMENT='学校库-目标学校主表'