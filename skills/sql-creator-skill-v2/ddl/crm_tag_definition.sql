CREATE TABLE `crm_tag_definition` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT COMMENT '标签ID主键',
  `tag_scope` varchar(50) NOT NULL COMMENT '标签适用范围：SCHOOL-学校标签，MAJOR_DIRECTION-专业方向',
  `name` varchar(100) NOT NULL COMMENT '标签展示名称，业务层限制最多50个字符',
  `publish_status` varchar(20) NOT NULL DEFAULT '1' COMMENT '发布状态编码：1-已发布，0-未发布',
  `del` tinyint(4) NOT NULL DEFAULT '0' COMMENT '是否删除：0-未删除，1-已删除',
  `created_by` int(11) DEFAULT NULL COMMENT '创建人用户ID',
  `updated_by` int(11) DEFAULT NULL COMMENT '最后更新人用户ID',
  `created_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '记录创建时间',
  `update_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '记录更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tag_scope_name` (`tag_scope`,`name`),
  KEY `idx_tag_definition_status` (`tag_scope`,`publish_status`,`del`),
  KEY `idx_tag_definition_update_time` (`update_time`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COMMENT='可复用标签定义表，与存量crm_tags表相互独立'