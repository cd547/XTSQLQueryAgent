CREATE TABLE `tk_season` (
  `id` bigint(11) NOT NULL,
  `title` varchar(128) NOT NULL COMMENT '标题',
  `sort` bigint(11) NOT NULL DEFAULT '9999' COMMENT '排序',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='季节表'