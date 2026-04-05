CREATE TABLE `admin_department_manage` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `admin_department_type_id` bigint(11) NOT NULL,
  `admin_department_children_id` bigint(11) NOT NULL,
  `admin_user_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `admin_department_manage_sy_4` (`admin_department_type_id`,`admin_department_children_id`,`admin_user_id`) USING BTREE,
  KEY `admin_department_manage_wj_2` (`admin_department_children_id`) USING BTREE,
  KEY `admin_department_manage_wj_3` (`admin_user_id`) USING BTREE,
  CONSTRAINT `admin_department_manage_ibfk_1` FOREIGN KEY (`admin_department_type_id`) REFERENCES `admin_department_type` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `admin_department_manage_ibfk_2` FOREIGN KEY (`admin_department_children_id`) REFERENCES `admin_department_children` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `admin_department_manage_ibfk_3` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=15477 DEFAULT CHARSET=utf8mb4 COMMENT='部门管理者配置'