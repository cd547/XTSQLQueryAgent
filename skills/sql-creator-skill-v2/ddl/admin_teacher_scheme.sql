CREATE TABLE `admin_teacher_scheme` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(1024) NOT NULL COMMENT '老师课时方案名称',
  `contest_amount` int(11) DEFAULT NULL COMMENT '竞赛金额（精确到分）',
  `english_amount` int(11) DEFAULT NULL COMMENT '英语授课金额（精确到分）',
  `teacher_level` varchar(1024) NOT NULL COMMENT '老师等级',
  `compulsory_hours` int(11) NOT NULL COMMENT '义务课时',
  `admin_user_id` int(11) NOT NULL COMMENT '创建人ID',
  `update_admin_user_id` int(11) DEFAULT NULL COMMENT '更新人ID',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间（时间戳）',
  `updated_time` bigint(11) DEFAULT NULL COMMENT '更新时间（时间戳）',
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `admin_teacher_scheme_wj_1` (`admin_user_id`) USING BTREE,
  KEY `admin_teacher_scheme_wj_2` (`update_admin_user_id`) USING BTREE,
  CONSTRAINT `admin_teacher_scheme_ibfk_1` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `admin_teacher_scheme_ibfk_2` FOREIGN KEY (`update_admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=140 DEFAULT CHARSET=utf8mb4 COMMENT='老师课时规则-方案'