-- 데이터베이스 생성
CREATE DATABASE IF NOT EXISTS bulletin_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bulletin_db;

-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  username   VARCHAR(50)  UNIQUE NOT NULL COMMENT '로그인 아이디',
  password   VARCHAR(255) NOT NULL         COMMENT 'bcrypt 해시',
  nickname   VARCHAR(100) NOT NULL         COMMENT '화면 표시 이름',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  role       VARCHAR(20)  NOT NULL DEFAULT 'user' COMMENT 'user | admin'
);

-- 게시글 테이블
CREATE TABLE IF NOT EXISTS posts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  content     TEXT         NOT NULL,
  author_id   INT          NOT NULL,
  author_name VARCHAR(100) NOT NULL,
  category    VARCHAR(50)  NOT NULL DEFAULT '자유게시판',
  views       INT          NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 좋아요 테이블
CREATE TABLE IF NOT EXISTS likes (
  user_id INT NOT NULL,
  post_id INT NOT NULL,
  PRIMARY KEY (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- 댓글 테이블
CREATE TABLE IF NOT EXISTS comments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  post_id     INT          NOT NULL,
  author_id   INT          NOT NULL,
  author_name VARCHAR(100) NOT NULL,
  content     TEXT         NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id)   REFERENCES posts(id)  ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)  ON DELETE CASCADE
);
