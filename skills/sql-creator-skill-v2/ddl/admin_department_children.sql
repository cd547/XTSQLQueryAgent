CREATE TABLE `admin_department_children` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `department_id` bigint(11) NOT NULL COMMENT '一级部门id',
  `name` varchar(255) NOT NULL COMMENT '二级部门名称',
  `del` int(11) NOT NULL DEFAULT '0',
  `created_time` bigint(11) DEFAULT NULL COMMENT '创建时间戳',
  `update_time` bigint(11) DEFAULT NULL COMMENT '更新时间戳',
  `admin_user_id` int(11) DEFAULT NULL COMMENT '最后更新人ID',
  `is_master` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否为代表部门：0-否，1-是（该二级部门名称与一级部门一致，代表整个一级部门）',
  PRIMARY KEY (`id`),
  KEY `admin_department_children_d_id` (`department_id`) USING BTREE,
  CONSTRAINT `admin_department_children_ibfk_1` FOREIGN KEY (`department_id`) REFERENCES `admin_department` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=381 DEFAULT CHARSET=utf8mb4 COMMENT='二级部门'