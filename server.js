require('dotenv').config();
const express = require('express');
const mysql2  = require('mysql2/promise');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const path    = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── DB 연결 풀 ────────────────────────────────────────────────────────────────
const pool = mysql2.createPool({
  host    : process.env.DB_HOST,
  port    : process.env.DB_PORT,
  user    : process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit   : 10,
});

// ─── JWT 인증 미들웨어 ──────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: '로그인이 필요합니다.' });
  }
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
  }
}

// ─── 관리자 전용 미들웨어 ────────────────────────────────────────────────────────
function adminMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ message: '로그인이 필요합니다.' });
  try {
    req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    if (req.user.role !== 'admin') return res.status(403).json({ message: '관리자만 접근 가능합니다.' });
    next();
  } catch {
    return res.status(401).json({ message: '유효하지 않은 토큰입니다.' });
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  인증 API
// ════════════════════════════════════════════════════════════════════════════════

// POST /api/signup  — 회원가입
app.post('/api/signup', async (req, res) => {
  const { username, password, nickname } = req.body;
  if (!username || !password || !nickname) {
    return res.status(400).json({ message: '모든 항목을 입력해주세요.' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.execute(
      'INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)',
      [username, hash, nickname]
    );
    res.status(201).json({ message: '회원가입이 완료되었습니다.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: '이미 사용 중인 아이디입니다.' });
    }
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/login  — 로그인 + JWT 발급
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: '아이디와 비밀번호를 입력해주세요.' });
  }
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    if (rows.length === 0) {
      return res.status(401).json({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, nickname: user.nickname, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '2h' }
    );
    res.json({ token, nickname: user.nickname, role: user.role });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/me  — 내 정보 조회 (JWT 필요)
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, username, nickname, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: '사용자를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
//  게시글 API
// ════════════════════════════════════════════════════════════════════════════════

// GET /api/posts  — 게시글 목록 (카테고리 필터 + 검색 + 정렬 + 좋아요/댓글 수)
app.get('/api/posts', async (req, res) => {
  const { sort = 'latest', category, search } = req.query;

  let sql = `
    SELECT p.id, p.title, p.author_name, p.category, p.views, p.created_at,
           COUNT(DISTINCT l.user_id) AS likes,
           COUNT(DISTINCT c.id)      AS comments
    FROM posts p
    LEFT JOIN likes    l ON p.id = l.post_id
    LEFT JOIN comments c ON p.id = c.post_id
    WHERE 1=1`;
  const params = [];

  if (category && category !== '전체') {
    sql += ' AND p.category = ?';
    params.push(category);
  }
  if (search) {
    sql += ' AND (p.title LIKE ? OR p.content LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  sql += ' GROUP BY p.id';
  if (sort === 'views')  sql += ' ORDER BY p.views DESC';
  else if (sort === 'likes') sql += ' ORDER BY likes DESC';
  else sql += ' ORDER BY p.created_at DESC';

  try {
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/posts/trending  — 인기글 TOP 5 (조회수 기준)
app.get('/api/posts/trending', async (_req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT p.id, p.title, p.author_name, p.views,
             COUNT(DISTINCT l.user_id) AS likes
      FROM posts p
      LEFT JOIN likes l ON p.id = l.post_id
      GROUP BY p.id
      ORDER BY p.views DESC
      LIMIT 5
    `);
    res.json(rows);
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/posts/:id  — 게시글 상세 조회 + 조회수 증가
app.get('/api/posts/:id', async (req, res) => {
  try {
    await pool.execute('UPDATE posts SET views = views + 1 WHERE id = ?', [req.params.id]);
    const [rows] = await pool.execute('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/posts  — 게시글 작성 (JWT 필요)
app.post('/api/posts', authMiddleware, async (req, res) => {
  const { title, content, category = '자유게시판' } = req.body;
  if (!title || !content) {
    return res.status(400).json({ message: '제목과 내용을 입력해주세요.' });
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO posts (title, content, author_id, author_name, category) VALUES (?, ?, ?, ?, ?)',
      [title, content, req.user.id, req.user.nickname, category]
    );
    res.status(201).json({ id: result.insertId, message: '게시글이 작성되었습니다.' });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// PUT /api/posts/:id  — 게시글 수정 (JWT 필요 + 본인만)
app.put('/api/posts/:id', authMiddleware, async (req, res) => {
  const { title, content, category } = req.body;
  if (!title || !content) {
    return res.status(400).json({ message: '제목과 내용을 입력해주세요.' });
  }
  try {
    const [rows] = await pool.execute(
      'SELECT author_id FROM posts WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    if (rows[0].author_id !== req.user.id) {
      return res.status(403).json({ message: '수정 권한이 없습니다.' });
    }
    await pool.execute(
      'UPDATE posts SET title = ?, content = ?, category = ? WHERE id = ?',
      [title, content, category || '자유게시판', req.params.id]
    );
    res.json({ message: '게시글이 수정되었습니다.' });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// DELETE /api/posts/:id  — 게시글 삭제 (JWT 필요 + 본인만)
app.delete('/api/posts/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT author_id FROM posts WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    if (rows[0].author_id !== req.user.id) {
      return res.status(403).json({ message: '삭제 권한이 없습니다.' });
    }
    await pool.execute('DELETE FROM posts WHERE id = ?', [req.params.id]);
    res.json({ message: '게시글이 삭제되었습니다.' });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/posts/:id/like  — 좋아요 토글 (JWT 필요)
app.post('/api/posts/:id/like', authMiddleware, async (req, res) => {
  const postId = req.params.id;
  const userId = req.user.id;
  try {
    const [rows] = await pool.execute(
      'SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId]
    );
    if (rows.length > 0) {
      await pool.execute('DELETE FROM likes WHERE user_id = ? AND post_id = ?', [userId, postId]);
      res.json({ liked: false });
    } else {
      await pool.execute('INSERT INTO likes (user_id, post_id) VALUES (?, ?)', [userId, postId]);
      res.json({ liked: true });
    }
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/posts/:id/like  — 좋아요 상태 확인
app.get('/api/posts/:id/like', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?', [req.user.id, req.params.id]
    );
    const [[{ cnt }]] = await pool.execute(
      'SELECT COUNT(*) as cnt FROM likes WHERE post_id = ?', [req.params.id]
    );
    res.json({ liked: rows.length > 0, count: cnt });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/posts/:id/comments  — 댓글 목록
app.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC', [req.params.id]
    );
    res.json(rows);
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// POST /api/posts/:id/comments  — 댓글 작성 (JWT 필요)
app.post('/api/posts/:id/comments', authMiddleware, async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ message: '댓글 내용을 입력해주세요.' });
  }
  try {
    const [result] = await pool.execute(
      'INSERT INTO comments (post_id, author_id, author_name, content) VALUES (?, ?, ?, ?)',
      [req.params.id, req.user.id, req.user.nickname, content.trim()]
    );
    res.status(201).json({
      id: result.insertId, author_name: req.user.nickname,
      content: content.trim(), created_at: new Date()
    });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// DELETE /api/comments/:id  — 댓글 삭제 (JWT 필요 + 본인만)
app.delete('/api/comments/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT author_id FROM comments WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: '댓글을 찾을 수 없습니다.' });
    if (rows[0].author_id !== req.user.id) return res.status(403).json({ message: '삭제 권한이 없습니다.' });
    await pool.execute('DELETE FROM comments WHERE id = ?', [req.params.id]);
    res.json({ message: '댓글이 삭제되었습니다.' });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
//  관리자 API
// ════════════════════════════════════════════════════════════════════════════════

// GET /api/admin/users  — 전체 회원 목록
app.get('/api/admin/users', adminMiddleware, async (_req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT u.id, u.username, u.nickname, u.role, u.created_at,
             COUNT(DISTINCT p.id) AS post_count
      FROM users u
      LEFT JOIN posts p ON u.id = p.author_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json(rows);
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// DELETE /api/admin/users/:id  — 회원 강제 탈퇴
app.delete('/api/admin/users/:id', adminMiddleware, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ message: '자기 자신은 삭제할 수 없습니다.' });
    }
    await pool.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: '회원이 삭제되었습니다.' });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/admin/posts  — 전체 게시글 목록 (관리자용)
app.get('/api/admin/posts', adminMiddleware, async (_req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT id, title, author_name, category, views, created_at
      FROM posts ORDER BY created_at DESC
    `);
    res.json(rows);
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// DELETE /api/admin/posts/:id  — 게시글 강제 삭제 (관리자)
app.delete('/api/admin/posts/:id', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id FROM posts WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: '게시글을 찾을 수 없습니다.' });
    await pool.execute('DELETE FROM posts WHERE id = ?', [req.params.id]);
    res.json({ message: '게시글이 삭제되었습니다.' });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// PUT /api/admin/users/:id/role  — 회원 권한 변경 (관리자)
app.put('/api/admin/users/:id/role', adminMiddleware, async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ message: '유효하지 않은 권한입니다.' });
  }
  if (parseInt(req.params.id) === req.user.id) {
    return res.status(400).json({ message: '자기 자신의 권한은 변경할 수 없습니다.' });
  }
  try {
    await pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ message: `권한이 ${role}로 변경되었습니다.` });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// DELETE /api/admin/comments/:id  — 댓글 강제 삭제 (관리자)
app.delete('/api/admin/comments/:id', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT id FROM comments WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: '댓글을 찾을 수 없습니다.' });
    await pool.execute('DELETE FROM comments WHERE id = ?', [req.params.id]);
    res.json({ message: '댓글이 삭제되었습니다.' });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// GET /api/stats  — 커뮤니티 통계
app.get('/api/stats', async (_req, res) => {
  try {
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) as total FROM posts');
    const [[{ views }]] = await pool.execute('SELECT COALESCE(SUM(views), 0) as views FROM posts');
    res.json({ total, views });
  } catch {
    res.status(500).json({ message: '서버 오류가 발생했습니다.' });
  }
});

// ─── 모든 페이지 요청 → public 폴더 서빙 ────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── 서버 시작 ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
