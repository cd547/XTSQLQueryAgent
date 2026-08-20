CREATE TABLE `crm_current_school` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '在读学校ID主键',
  `name` varchar(100) NOT NULL COMMENT '在读学校名称，业务层限制最多30个字符',
  `country_code` int(11) NOT NULL COMMENT '所属国家字典编码，对应sys_dict_item.code',
  `country_name` varchar(100) NOT NULL COMMENT '所属国家/地区中文名称，兼容历史字段并与字典标题同步',
  `region_name` varchar(100) DEFAULT NULL COMMENT '所属地区名称，仅中国学校必填',
  `ownership_nature_code` int(11) DEFAULT NULL COMMENT '办学性质编码，允许为空，对应sys_dict_item.code',
  `version` int(11) NOT NULL DEFAULT '0' COMMENT '乐观锁版本号',
  `del` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除：0-未删除，1-已删除',
  `created_by` int(11) DEFAULT NULL COMMENT '创建人用户ID',
  `updated_by` int(11) DEFAULT NULL COMMENT '最后更新人用户ID',
  `created_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_current_school_name` (`name`),
  KEY `idx_current_school_location` (`country_code`,`del`,`region_name`(50)),
  KEY `idx_current_school_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COMMENT='学校库-在读学校主表'