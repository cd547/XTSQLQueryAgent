CREATE TABLE `keqiao_quiz_result` (
  `id` bigint(11) NOT NULL AUTO_INCREMENT,
  `keqiao_quiz_id` bigint(11) NOT NULL COMMENT '考试测验ID',
  `edu_student_id` bigint(11) NOT NULL COMMENT '学生ID',
  `is_score` int(11) NOT NULL DEFAULT '1' COMMENT '是否缺考 1为正常 2为缺考',
  `score` int(11) NOT NULL COMMENT '学生分数 （列：100分 = 10000）',
  `comment` varchar(2048) DEFAULT NULL COMMENT '评价',
  `level` varchar(255) DEFAULT NULL COMMENT '自定义等级',
  `admin_user_id` int(11) NOT NULL COMMENT '操作人ID',
  `created_time` bigint(11) NOT NULL,
  `del` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `keqiao_quiz_result2` (`edu_student_id`) USING BTREE,
  KEY `keqiao_quiz_result_3` (`admin_user_id`) USING BTREE,
  KEY `keqiao_quiz_result_sy_3` (`keqiao_quiz_id`,`edu_student_id`) USING BTREE,
  CONSTRAINT `keqiao_quiz_result_ibfk_1` FOREIGN KEY (`edu_student_id`) REFERENCES `edu_student` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `keqiao_quiz_result_ibfk_2` FOREIGN KEY (`keqiao_quiz_id`) REFERENCES `keqiao_quiz` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT `keqiao_quiz_result_ibfk_3` FOREIGN KEY (`admin_user_id`) REFERENCES `admin_user` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION
) ENGINE=InnoDB AUTO_INCREMENT=1415 DEFAULT CHARSET=utf8mb4 COMMENT='考试测验 - 成绩'