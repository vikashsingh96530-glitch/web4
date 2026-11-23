const fs = require('fs/promises');
const path = require('path');

const dataFile = path.join(__dirname, '..', 'data', 'database.json');

let database = { users: [], notes: [] };

async function load() {
  try {
    database = JSON.parse(await fs.readFile(dataFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function save() {
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(dataFile, JSON.stringify(database, null, 2));
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

module.exports = {
  load,
  save,
  users: {
    findByEmail: (email) => database.users.find((user) => user.email === email),
    findById: (id) => database.users.find((user) => user.id === id),
    findAll: () => database.users.map(({ passwordHash, ...user }) => user),
    create: async (user) => {
      const created = { ...user, id: nextId(database.users) };
      database.users.push(created);
      await save();
      return created;
    }
  },
  notes: {
    findById: (id) => database.notes.find((note) => note.id === id),
    findByOwner: (ownerId) => database.notes.filter((note) => note.ownerId === ownerId),
    findAll: () => database.notes,
    create: async (note) => {
      const created = { ...note, id: nextId(database.notes) };
      database.notes.push(created);
      await save();
      return created;
    },
    update: async (id, changes) => {
      const note = database.notes.find((item) => item.id === id);
      if (!note) return null;
      Object.assign(note, changes, { updatedAt: new Date().toISOString() });
      await save();
      return note;
    },
    remove: async (id) => {
      const index = database.notes.findIndex((note) => note.id === id);
      if (index === -1) return false;
      database.notes.splice(index, 1);
      await save();
      return true;
    }
  }
};
