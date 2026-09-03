CREATE TABLE `edu_achievement_annex` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `edu_achievement_id` bigint(11) NOT NULL,
  `img_url` varchar(255) NOT NULL COMMENT '附件地址',
  PRIMARY KEY (`id`),
  KEY `edu_achievement_annex_wj_1` (`edu_achievement_id`) USING BTREE,
  CONSTRAINT `edu_achievement_annex_ibfk_1` FOREIGN KEY (`edu_achievement_id`) REFERENCES `edu_achievement` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=10226 DEFAULT CHARSET=utf8mb4 COMMENT='测试成绩-附件'