# 커뮤니티 게시판 (Bulletin Board)

## 1. 프로젝트 개요

- **수행 주제:** JWT 인증 기반의 커뮤니티 게시판 — 회원가입/로그인 후 게시글 CRUD, 댓글, 좋아요, 카테고리/검색/정렬 구현
- **배포 주소:** https://squeeze-cubbyhole-antelope.ngrok-free.dev
- **사용 기술:** HTML, CSS, Tailwind CSS, Vanilla JS, Node.js (Express), MariaDB, JWT, GCP, ngrok

---

## 2. 백엔드 구성 및 라우팅

`server.js` 하나에 DB 연결, JWT 미들웨어, 전체 API 라우팅을 구성했습니다.

| 메서드 | 경로 | 인증 | 역할 |
|--------|------|------|------|
| POST | `/api/signup` | 불필요 | 회원가입 (bcrypt 비밀번호 해시 저장) |
| POST | `/api/login` | 불필요 | 로그인 및 JWT 발급 |
| GET | `/api/me` | JWT 필요 | 로그인한 사용자 정보 조회 |
| GET | `/api/posts` | 불필요 | 게시글 목록 (카테고리·검색·정렬 필터, 좋아요·댓글 수 포함) |
| GET | `/api/posts/trending` | 불필요 | 인기글 TOP 5 (조회수 기준) |
| GET | `/api/posts/:id` | 불필요 | 게시글 상세 조회 + 조회수 자동 증가 |
| POST | `/api/posts` | JWT 필요 | 게시글 작성 |
| PUT | `/api/posts/:id` | JWT 필요 | 게시글 수정 (본인만) |
| DELETE | `/api/posts/:id` | JWT 필요 | 게시글 삭제 (본인만) |
| GET | `/api/posts/:id/like` | JWT 필요 | 좋아요 상태 및 수 조회 |
| POST | `/api/posts/:id/like` | JWT 필요 | 좋아요 토글 |
| GET | `/api/posts/:id/comments` | 불필요 | 댓글 목록 조회 |
| POST | `/api/posts/:id/comments` | JWT 필요 | 댓글 작성 |
| DELETE | `/api/comments/:id` | JWT 필요 | 댓글 삭제 (본인만) |
| GET | `/api/stats` | 불필요 | 전체 게시글 수 및 총 조회수 |

JWT 인증은 `authMiddleware` 함수로 분리하여 보호가 필요한 라우트에만 적용했습니다.  
수정·삭제 시 `author_id`와 JWT의 사용자 id를 비교해 본인 글/댓글만 처리되도록 권한을 검증합니다.

---

## 3. 데이터베이스 및 SQL 활용

**사용 테이블:** `users` (사용자), `posts` (게시글), `likes` (좋아요), `comments` (댓글)

```sql
CREATE TABLE users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  username   VARCHAR(50)  UNIQUE NOT NULL,
  password   VARCHAR(255) NOT NULL,
  nickname   VARCHAR(100) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  role       VARCHAR(20)  NOT NULL DEFAULT 'user'  -- 'user' | 'admin'
);

CREATE TABLE posts (
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

CREATE TABLE likes (
  user_id INT NOT NULL,
  post_id INT NOT NULL,
  PRIMARY KEY (user_id, post_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE comments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  post_id     INT          NOT NULL,
  author_id   INT          NOT NULL,
  author_name VARCHAR(100) NOT NULL,
  content     TEXT         NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id)   REFERENCES posts(id)  ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)  ON DELETE CASCADE
);
```

**주요 SQL 쿼리:**

```sql
-- 게시글 목록: 카테고리 필터 + 검색 + 정렬 + 좋아요/댓글 수 집계 (JOIN + GROUP BY)
SELECT p.id, p.title, p.author_name, p.category, p.views, p.created_at,
       COUNT(DISTINCT l.user_id) AS likes,
       COUNT(DISTINCT c.id)      AS comments
FROM posts p
LEFT JOIN likes    l ON p.id = l.post_id
LEFT JOIN comments c ON p.id = c.post_id
WHERE p.category = ? AND (p.title LIKE ? OR p.content LIKE ?)
GROUP BY p.id
ORDER BY likes DESC;

-- 인기글 TOP 5 (조회수 기준)
SELECT p.id, p.title, p.author_name, p.views,
       COUNT(DISTINCT l.user_id) AS likes
FROM posts p
LEFT JOIN likes l ON p.id = l.post_id
GROUP BY p.id
ORDER BY p.views DESC
LIMIT 5;

-- 좋아요 토글 (중복 방지: PRIMARY KEY 복합키)
INSERT INTO likes (user_id, post_id) VALUES (?, ?);
DELETE FROM likes WHERE user_id = ? AND post_id = ?;

-- 조회수 자동 증가
UPDATE posts SET views = views + 1 WHERE id = ?;
```

---

## 4. 인프라 및 배포 기록

**클라우드 서버 (GCP VM)**
- GCP Compute Engine에서 VM 인스턴스 생성 (Ubuntu)
- Node.js, MariaDB 설치 후 `init.sql`로 DB 및 테이블 초기화
- `pm2`를 사용하여 터미널 종료 후에도 서버가 상시 실행되도록 설정

```bash
pm2 start server.js
pm2 save
```

**도메인 연결 (ngrok)**
- `cloudflared` 임시 터널은 재시작 시 URL이 변경되는 문제로 ngrok static domain으로 전환
- ngrok 무료 플랜의 고정 도메인을 활용해 HTTPS 보안 접속 구현
- PM2로 서버와 ngrok 터널을 함께 관리하여 VM 재부팅 시 자동 복구

```bash
pm2 start "ngrok http --domain=squeeze-cubbyhole-antelope.ngrok-free.dev 3000" --name tunnel
pm2 save && pm2 startup
```

---

## 5. 트러블슈팅 (문제 해결 기록)

**사례 1: Cloudflare 도메인 없이 HTTPS 고정 URL 확보**

`cloudflared` 임시 터널은 재시작 시 URL이 매번 변경되는 문제가 있었습니다. Cloudflare named tunnel은 도메인 구매가 필요해 무료로 고정 URL을 확보하기 위해 ngrok으로 전환했습니다. ngrok 무료 플랜에서 제공하는 static domain(`ngrok-free.dev`)을 활용해 PM2와 함께 영구 실행 환경을 구성했습니다.

```bash
pm2 start "ngrok http --domain=squeeze-cubbyhole-antelope.ngrok-free.dev 3000" --name tunnel
```

**사례 2: DB 생성 권한 오류**

`init.sql` 실행 시 아래 에러 발생:
```
ERROR 1044 (42000): Access denied for user 'testuser'@'localhost' to database 'bulletin_db'
```
`testuser`에게 DB 생성 권한이 없었기 때문에, `root` 계정으로 DB를 먼저 생성한 뒤 권한을 부여하는 방식으로 해결했습니다.

```sql
CREATE DATABASE bulletin_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON bulletin_db.* TO 'testuser'@'localhost';
FLUSH PRIVILEGES;
```

**사례 3: `/api/posts/trending` 라우트 충돌**

`GET /api/posts/:id`보다 `GET /api/posts/trending`을 먼저 등록하지 않으면 Express가 `trending`을 `:id` 파라미터로 인식해 DB에서 id=`trending`을 조회하는 문제가 발생했습니다.  
라우트 선언 순서를 `trending` → `:id` 순으로 변경하여 해결했습니다.

```js
app.get('/api/posts/trending', ...); // 반드시 먼저 선언
app.get('/api/posts/:id', ...);
```

**사례 4: 서버 재시작 시 포트 충돌**

```
Error: listen EADDRINUSE: address already in use :::3000
```
이전 프로세스가 종료되지 않고 포트를 점유하고 있었기 때문에 PID를 확인 후 강제 종료하여 해결했습니다.

```bash
netstat -ano | grep ":3000"
powershell -Command "Stop-Process -Id [PID] -Force"
```

---

## 6. 최종 회고

**배운 점**
- JWT 발급부터 미들웨어 검증, 권한 분기까지 인증 흐름 전체를 직접 구현하며 동작 원리를 명확히 이해했습니다.
- LEFT JOIN + GROUP BY를 활용해 게시글 목록에 좋아요·댓글 수를 한 번의 쿼리로 집계하는 방법을 익혔습니다.
- 라우트 선언 순서가 Express의 요청 처리에 직접 영향을 준다는 점을 실수를 통해 체득했습니다.
- `cloudflared`를 활용하면 별도의 Nginx나 방화벽 설정 없이도 HTTPS 배포가 가능합니다.

**개선 계획**
- 페이지네이션 (글이 많아질 경우 성능 저하 방지)
- 태그 시스템 (게시글당 최대 5개 태그)
- 이미지 첨부 기능 (multer 활용)
- 실시간 알림 (WebSocket)
- 환경변수 관리 강화 및 프로덕션 배포 시 `pm2` + Nginx 조합으로 전환
