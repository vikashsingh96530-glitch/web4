require('dotenv').config();

const express = require('express');
const http = require('http');
const bcrypt = require('bcrypt');
const { Server } = require('socket.io');
const { EventEmitter } = require('events');

const store = require('./src/store');
const { signToken, authenticate, requireRole, verifySocketToken } = require('./src/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const platformEvents = new EventEmitter();

app.use(express.json());
app.use(express.static('public'));

platformEvents.on('user.signup', (user) => {
  console.log(`[EVENT] Signup: ${user.email}`);
});
platformEvents.on('user.login', (user) => {
  console.log(`[EVENT] Login: ${user.email}`);
});
platformEvents.on('note.created', (note) => {
  console.log(`[EVENT] Note created: ${note.id} by user ${note.ownerId}`);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Secure Connect Platform' });
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (store.users.findByEmail(normalizedEmail)) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await store.users.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      role: 'user',
      createdAt: new Date().toISOString()
    });

    platformEvents.emit('user.signup', user);
    res.status(201).json({
      message: 'Signup successful',
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Signup failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = store.users.findByEmail(email.toLowerCase().trim());
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    platformEvents.emit('user.login', user);
    res.json({
      message: 'Login successful',
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/profile', authenticate, (req, res) => {
  const user = store.users.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

app.get('/api/admin/users', authenticate, requireRole('admin'), (req, res) => {
  res.json({ users: store.users.findAll() });
});

app.get('/api/notes', authenticate, (req, res) => {
  const notes = req.user.role === 'admin'
    ? store.notes.findAll()
    : store.notes.findByOwner(req.user.id);
  res.json({ notes });
});

app.post('/api/notes', authenticate, async (req, res) => {
  try {
    const { title, content } = req.body;
    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const note = await store.notes.create({
      title: title.trim(),
      content: content.trim(),
      ownerId: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    platformEvents.emit('note.created', note);
    res.status(201).json({ message: 'Note created', note });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not create note' });
  }
});

app.put('/api/notes/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  const note = store.notes.findById(id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (req.user.role !== 'admin' && note.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'You cannot update this note' });
  }

  const title = req.body.title ?? note.title;
  const content = req.body.content ?? note.content;
  if (!title || !content) return res.status(400).json({ error: 'Title and content cannot be empty' });

  const updated = await store.notes.update(id, { title: title.trim(), content: content.trim() });
  res.json({ message: 'Note updated', note: updated });
});

app.delete('/api/notes/:id', authenticate, async (req, res) => {
  const id = Number(req.params.id);
  const note = store.notes.findById(id);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  if (req.user.role !== 'admin' && note.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'You cannot delete this note' });
  }

  await store.notes.remove(id);
  res.json({ message: 'Note deleted' });
});

io.use(verifySocketToken);
io.on('connection', (socket) => {
  console.log(`[SOCKET] ${socket.user.email} connected (${socket.id})`);

  socket.on('chat:message', (payload) => {
    const text = typeof payload === 'string' ? payload : payload?.text;
    if (!text || !text.trim()) return;

    const message = {
      id: `${Date.now()}-${socket.id}`,
      sender: socket.user.email,
      text: text.trim().slice(0, 500),
      timestamp: new Date().toISOString()
    };
    platformEvents.emit('chat.message', message);
    io.emit('chat:message', message);
  });

  socket.on('disconnect', () => {
    console.log(`[SOCKET] ${socket.user.email} disconnected (${socket.id})`);
  });
});

platformEvents.on('chat.message', (message) => {
  console.log(`[CHAT] ${message.sender}: ${message.text}`);
});

async function start() {
  await store.load();

  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword && !store.users.findByEmail(adminEmail)) {
    await store.users.create({
      name: 'Administrator',
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      role: 'admin',
      createdAt: new Date().toISOString()
    });
    console.log(`[BOOTSTRAP] Admin account created: ${adminEmail}`);
  }

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Secure Connect Platform running at http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
