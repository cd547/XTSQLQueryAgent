CREATE TABLE `edu_study_feedback_type` (
  `id` bigint(11) NOT NULL,
  `name` varchar(255) NOT NULL COMMENT '反馈名称',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='考勤反馈名称'