CREATE TABLE `edu_student_status` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL COMMENT '类型名称',
  `type` int(11) NOT NULL COMMENT '学生类型 1 学通学生 2客户 3科桥 （同学生type字段）',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  `del` int(11) NOT NULL DEFAULT '0' COMMENT '禁用0未禁用1禁用',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COMMENT='学生状态(datasy)'