# Lab 4: Secure Connect and Communication Platform

A Node.js lab project using Express, bcrypt, JWT, dotenv, Socket.IO, and JSON file persistence.

## Start

```powershell
npm install
npm start
```

Open `http://localhost:3000`.

The default administrator is configured in `.env`:

- Email: `admin@example.com`
- Password: `Admin123!`

Change these values before production use.

## API

- `POST /api/auth/signup` — create a normal user
- `POST /api/auth/login` — return a JWT
- `GET /api/profile` — protected profile
- `GET /api/admin/users` — administrator-only user list
- `GET /api/notes` — list accessible notes
- `POST /api/notes` — create a note
- `PUT /api/notes/:id` — update a note
- `DELETE /api/notes/:id` — delete a note

Send protected requests with `Authorization: Bearer <token>`.

Socket.IO chat requires the same JWT in the handshake:

```js
io({ auth: { token: "<jwt>" } })
```
