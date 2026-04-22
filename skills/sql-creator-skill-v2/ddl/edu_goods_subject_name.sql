CREATE TABLE `edu_goods_subject_name` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `goods_id` bigint(11) NOT NULL COMMENT '产品ID',
  `subject_name_id` bigint(11) NOT NULL COMMENT '科目名称ID',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `goodsidsubname1` (`goods_id`) USING BTREE,
  KEY `goodsidsname2` (`subject_name_id`) USING BTREE,
  CONSTRAINT `goodsidsname2` FOREIGN KEY (`subject_name_id`) REFERENCES `edu_course_exam_subject_name` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `goodsidsubname1` FOREIGN KEY (`goods_id`) REFERENCES `edu_goods` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=1518292 DEFAULT CHARSET=utf8mb4 COMMENT='产品-绑定的科目名称'