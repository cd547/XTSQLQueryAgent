CREATE TABLE `edu_achievement_knowledge` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `edu_achievement_id` bigint(11) NOT NULL,
  `tk_knowledge_id` bigint(11) NOT NULL COMMENT '知识点ID',
  PRIMARY KEY (`id`),
  KEY `edu_achievement_knowledge_wj_1` (`edu_achievement_id`) USING BTREE,
  KEY `edu_achievement_knowledge_wj_2` (`tk_knowledge_id`) USING BTREE,
  CONSTRAINT `edu_achievement_knowledge_ibfk_1` FOREIGN KEY (`edu_achievement_id`) REFERENCES `edu_achievement` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=10886 DEFAULT CHARSET=utf8mb4 COMMENT='测试成绩-知识点'