CREATE TABLE `edu_student_personnel` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `student_id` bigint(11) NOT NULL COMMENT '学生ID',
  `type` int(11) NOT NULL COMMENT '类型1助教2客服(班主任)3老师4顾问5生活老师\ntype\n1 :  留学顾问\n2：班主任（原客服）\n3：学术老师\n4：规划顾问',
  `admin_user_id` int(11) NOT NULL COMMENT '关联人员ID',
  `created_time` bigint(20) NOT NULL,
  `update_time` bigint(20) NOT NULL,
  `del` int(255) NOT NULL DEFAULT '0',
  `rel` int(255) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `edu_student_personnel1` (`admin_user_id`) USING BTREE,
  KEY `edu_student_personnel2` (`student_id`) USING BTREE,
  KEY `idx_student_type_del` (`student_id`,`type`,`del`),
  CONSTRAINT `edu_student_personnel1` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `edu_student_personnel2` FOREIGN KEY (`student_id`) REFERENCES `edu_student` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=39588 DEFAULT CHARSET=utf8mb4 COMMENT='学生相关工作人员表'