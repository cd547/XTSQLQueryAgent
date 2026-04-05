CREATE TABLE `admin_user_campus` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `admin_user_id` int(11) NOT NULL COMMENT '后台用户ID',
  `edu_campus_id` bigint(11) NOT NULL COMMENT '校区ID',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `admin_user_campus1` (`admin_user_id`) USING BTREE,
  KEY `admin_user_campus2` (`edu_campus_id`) USING BTREE,
  CONSTRAINT `admin_user_campus_ibfk_1` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `admin_user_campus_ibfk_2` FOREIGN KEY (`edu_campus_id`) REFERENCES `edu_campus` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=38897 DEFAULT CHARSET=utf8mb4 COMMENT='所属校区'