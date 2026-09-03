CREATE TABLE `edu_teacher_annex` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `edu_teacher_id` bigint(11) NOT NULL COMMENT '老师ID',
  `url` varchar(500) NOT NULL COMMENT '附件URL',
  `created_time` bigint(11) NOT NULL COMMENT '创建时间',
  `del` int(11) NOT NULL DEFAULT '0' COMMENT '是否删除 0正常 1删除',
  `created_admin_user_id` int(11) DEFAULT NULL COMMENT '创建人',
  `del_admin_user_id` int(11) DEFAULT NULL COMMENT '删除人',
  `type` int(11) NOT NULL DEFAULT '1' COMMENT '1普通附件 2师资册图片',
  `auto_flag` tinyint(4) NOT NULL DEFAULT '0' COMMENT '自动创建标记：0-否，1-是',
  PRIMARY KEY (`id`),
  KEY `edu_teacher_annex_wj_1` (`edu_teacher_id`) USING BTREE,
  KEY `edu_teacher_annex_wj_2` (`created_admin_user_id`) USING BTREE,
  KEY `edu_teacher_annex_wj_3` (`del_admin_user_id`) USING BTREE,
  CONSTRAINT `edu_teacher_annex_ibfk_1` FOREIGN KEY (`edu_teacher_id`) REFERENCES `edu_teacher` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_teacher_annex_wj_2` FOREIGN KEY (`created_admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_teacher_annex_wj_3` FOREIGN KEY (`del_admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=5864 DEFAULT CHARSET=utf8mb4 COMMENT='老师附件'