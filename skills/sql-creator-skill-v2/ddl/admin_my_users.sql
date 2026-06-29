CREATE TABLE `admin_my_users` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `admin_user_id` int(11) NOT NULL COMMENT '后台用户ID',
  `my_user_id` bigint(11) NOT NULL COMMENT '用户ID',
  PRIMARY KEY (`id`),
  KEY `admin_my_users1` (`admin_user_id`) USING BTREE,
  KEY `admin_my_users2` (`my_user_id`) USING BTREE,
  CONSTRAINT `admin_my_users_ibfk_1` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `admin_my_users_ibfk_2` FOREIGN KEY (`my_user_id`) REFERENCES `my_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=667 DEFAULT CHARSET=utf8mb4 COMMENT='后台管理员关联用户表'