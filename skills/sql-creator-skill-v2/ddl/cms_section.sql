CREATE TABLE `cms_section` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT COMMENT ' ',
  `parent_id` bigint(11) NOT NULL DEFAULT '0' COMMENT '上级栏目 0 为一级栏目',
  `seo_tag` varchar(255) DEFAULT NULL COMMENT 'seo搜索标签',
  `name` varchar(255) NOT NULL COMMENT '栏目名称（前台显示）',
  `title` varchar(255) DEFAULT NULL COMMENT '标题名称',
  `keyword` varchar(1024) DEFAULT NULL COMMENT '关键词',
  `description` varchar(1024) DEFAULT NULL COMMENT '介绍',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=786 DEFAULT CHARSET=utf8mb4 COMMENT='栏目'