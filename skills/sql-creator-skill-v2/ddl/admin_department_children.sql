CREATE TABLE `admin_department_children` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `department_id` bigint(11) NOT NULL COMMENT '一级部门id',
  `name` varchar(255) NOT NULL COMMENT '二级部门名称',
  `created_time` bigint(11) DEFAULT NULL,
  `update_time` bigint(11) DEFAULT NULL,
  `admin_user_id` int(11) DEFAULT NULL COMMENT '最后更新人',
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `admin_department_children_d_id` (`department_id`) USING BTREE,
  KEY `admin_department_children_d_id_2` (`admin_user_id`) USING BTREE,
  CONSTRAINT `admin_department_children_d_id` FOREIGN KEY (`department_id`) REFERENCES `admin_department` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `admin_department_children_d_id_2` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=195 DEFAULT CHARSET=utf8mb4 COMMENT='二级部门'