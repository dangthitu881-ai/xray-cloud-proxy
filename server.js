const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ===== CONFIG - Set trên Railway biến môi trường =====
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'changeme';
const BASE_URL = 'https://apis.roblox.com/datastores/v1/universes';
const DATASTORE_NAME = 'XRay_HubProjects';
const DEFAULT_UNIVERSE_ID = '8918651601';

// ===== DATASTORE HELPERS (dùng nội bộ cho auth) =====
async function dsGet(entryKey) {
	const url = `${BASE_URL}/${DEFAULT_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`
		+ `?dataStoreName=${encodeURIComponent(DATASTORE_NAME)}`
		+ `&id=${encodeURIComponent(entryKey)}`;
	const response = await fetch(url, {
		method: 'GET',
		headers: { 'x-api-key': ROBLOX_API_KEY }
	});
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`DS GET ${response.status}`);
	const text = await response.text();
	try { return JSON.parse(text); } catch { return text; }
}

async function dsSet(entryKey, data) {
	const url = `${BASE_URL}/${DEFAULT_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`
		+ `?dataStoreName=${encodeURIComponent(DATASTORE_NAME)}`
		+ `&id=${encodeURIComponent(entryKey)}`;
	const body = typeof data === 'string' ? data : JSON.stringify(data);
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'x-api-key': ROBLOX_API_KEY, 'content-type': 'application/json' },
		body: body
	});
	if (!response.ok) throw new Error(`DS POST ${response.status}`);
	return true;
}

async function dsDelete(entryKey) {
	const url = `${BASE_URL}/${DEFAULT_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`
		+ `?dataStoreName=${encodeURIComponent(DATASTORE_NAME)}`
		+ `&id=${encodeURIComponent(entryKey)}`;
	const response = await fetch(url, {
		method: 'DELETE',
		headers: { 'x-api-key': ROBLOX_API_KEY }
	});
	if (!response.ok) throw new Error(`DS DELETE ${response.status}`);
	return true;
}

async function dsList(prefix) {
	const url = `${BASE_URL}/${DEFAULT_UNIVERSE_ID}/standard-datastores/datastore/entries`
		+ `?dataStoreName=${encodeURIComponent(DATASTORE_NAME)}`
		+ `&prefix=${encodeURIComponent(prefix)}`;
	const response = await fetch(url, {
		method: 'GET',
		headers: { 'x-api-key': ROBLOX_API_KEY }
	});
	if (!response.ok) throw new Error(`DS LIST ${response.status}`);
	const data = await response.json();
	return data.keys || [];
}

// ===== TOKEN GENERATOR =====
function generateToken() {
	return crypto.randomBytes(32).toString('hex');
}

// ===== DISCORD WEBHOOK =====
async function sendDiscordNotification(username, lookingFor) {
	if (!DISCORD_WEBHOOK_URL) return;
	try {
		await fetch(DISCORD_WEBHOOK_URL, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				content: `🆕 **New Registration Request**\n**Username:** ${username}\n**Looking For:** ${lookingFor || 'N/A'}\nApprove: POST /api/admin/approve {username, secret}\nDeny: POST /api/admin/deny {username, secret}`,
				embeds: [{
					title: 'New User Registration',
					fields: [
						{ name: 'Username', value: username, inline: true },
						{ name: 'Looking For', value: lookingFor || 'N/A', inline: true },
						{ name: 'Status', value: '⏳ Pending', inline: true }
					],
					color: 16776960,
					timestamp: new Date().toISOString()
				}]
			})
		});
	} catch (err) {
		console.error('Discord webhook failed:', err.message);
	}
}

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => {
	res.json({
		status: "ok",
		configured: !!ROBLOX_API_KEY,
		discordConfigured: !!DISCORD_WEBHOOK_URL,
		allowedDataStores: ["XRay_CloudData"]
	});
});

// ===== USER VERIFICATION PROXY =====
app.post('/api/users/verify-username', async (req, res) => {
	const { username } = req.body;

	if (!username || typeof username !== 'string') {
		return res.status(400).json({ success: false, error: "Invalid or missing username" });
	}

	try {
		const response = await fetch('https://users.roblox.com/v1/usernames/users', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				usernames: [username],
				excludeBannedUsers: true
			})
		});

		if (!response.ok) {
			const errText = await response.text();
			return res.status(response.status).json({ success: false, error: `Roblox Users API ${response.status}: ${errText}` });
		}

		const data = await response.json();

		if (data.data && data.data.length > 0) {
			const user = data.data[0];
			return res.json({
				success: true,
				found: true,
				id: user.id,
				displayName: user.displayName
			});
		} else {
			return res.json({ success: true, found: false });
		}
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

// ===== AUTH ENDPOINTS =====
app.post('/api/auth/register', async (req, res) => {
	let { username, lookingFor } = req.body;

	// FIX: Chống crash server (502) do TypeError khi username không phải là chuỗi (string)
	if (!username || typeof username !== 'string') {
		return res.status(400).json({ success: false, error: 'Invalid username format' });
	}

	if (username.length < 3 || username.length > 20) {
		return res.status(400).json({ success: false, error: 'Username must be 3-20 characters' });
	}

	username = username.replace(/^[\s@]+|[\s\u200B-\u200F\uFEFF]+$/g, '');
	if (!/^[a-zA-Z0-9_.]+$/.test(username)) {
		return res.status(400).json({ success: false, error: 'Username can only contain letters, numbers, underscores, and dots' });
	}

	try {
		const users = (await dsGet('_users')) || {};

		if (users[username]) {
			if (users[username].status === 'approved') return res.status(409).json({ success: false, error: 'Username already taken' });
			if (users[username].status === 'pending') return res.status(409).json({ success: false, error: 'Registration already pending approval' });
			if (users[username].status === 'denied') return res.status(403).json({ success: false, error: 'Registration was denied. Contact admin.' });
			return res.status(409).json({ success: false, error: 'Username already taken' });
		}

		users[username] = {
			status: 'pending',
			lookingFor: lookingFor || '',
			createdAt: Date.now()
		};

		await dsSet('_users', users);
		sendDiscordNotification(username, lookingFor);

		return res.json({
			success: true,
			status: 'pending',
			message: 'Registration submitted! Waiting for admin approval via Discord.'
		});
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.post('/api/auth/login', async (req, res) => {
	const { username } = req.body;

	if (!username || typeof username !== 'string') {
		return res.status(400).json({ success: false, error: 'Invalid or missing username' });
	}

	try {
		const users = (await dsGet('_users')) || {};
		const user = users[username];

		if (!user) return res.status(404).json({ success: false, error: 'Account not found. Please register first.' });
		if (user.status === 'pending') return res.status(403).json({ success: false, error: 'Account pending approval. Please wait for admin to approve.' });
		if (user.status === 'denied') return res.status(403).json({ success: false, error: 'Account was denied. Contact admin.' });

		const token = generateToken();
		const tokens = (await dsGet('_tokens')) || {};
		tokens[token] = { username, createdAt: Date.now() };
		await dsSet('_tokens', tokens);

		return res.json({ success: true, token: token, username: username });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.get('/api/auth/status', async (req, res) => {
	const { username } = req.query;
	if (!username) return res.status(400).json({ success: false, error: 'Missing username' });
	try {
		const users = (await dsGet('_users')) || {};
		const user = users[username];
		if (!user) return res.json({ success: true, exists: false });
		return res.json({ success: true, exists: true, status: user.status });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.post('/api/auth/logout', async (req, res) => {
	const authHeader = req.headers['authorization'];
	const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

	if (!token) return res.status(400).json({ success: false, error: 'Missing token' });

	try {
		const tokens = (await dsGet('_tokens')) || {};
		if (tokens[token]) {
			delete tokens[token];
			await dsSet('_tokens', tokens);
		}
		return res.json({ success: true });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.get('/api/auth/verify', async (req, res) => {
	const authHeader = req.headers['authorization'];
	const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

	if (!token) return res.status(401).json({ success: false, error: 'Missing token' });

	try {
		const tokens = (await dsGet('_tokens')) || {};
		const session = tokens[token];

		if (!session) return res.status(401).json({ success: false, error: 'Invalid or expired token' });

		return res.json({ success: true, valid: true, username: session.username });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

// ===== ADMIN ENDPOINTS =====
app.post('/api/admin/approve', async (req, res) => {
	const { username, secret } = req.body;
	if (!secret || secret !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized' });
	if (!username) return res.status(400).json({ success: false, error: 'Missing username' });
	try {
		const users = (await dsGet('_users')) || {};
		if (!users[username]) return res.status(404).json({ success: false, error: 'User not found' });
		if (users[username].status === 'approved') return res.status(409).json({ success: false, error: 'Already approved' });

		users[username].status = 'approved';
		users[username].approvedAt = Date.now();
		await dsSet('_users', users);
		return res.json({ success: true, message: username + ' approved' });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.post('/api/admin/deny', async (req, res) => {
	const { username, secret } = req.body;
	if (!secret || secret !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized' });
	if (!username) return res.status(400).json({ success: false, error: 'Missing username' });
	try {
		const users = (await dsGet('_users')) || {};
		if (!users[username]) return res.status(404).json({ success: false, error: 'User not found' });

		users[username].status = 'denied';
		users[username].deniedAt = Date.now();
		await dsSet('_users', users);
		return res.json({ success: true, message: username + ' denied' });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.get('/api/admin/pending', async (req, res) => {
	const secret = req.query.secret;
	if (!secret || secret !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized' });
	try {
		const users = (await dsGet('_users')) || {};
		const pending = {};
		for (const [name, data] of Object.entries(users)) {
			if (data.status === 'pending') {
				pending[name] = { lookingFor: data.lookingFor, createdAt: data.createdAt };
			}
		}
		return res.json({ success: true, pending });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

// ===== DATASTORE PROXY =====
app.get('/api/datastore', async (req, res) => {
	const { universeId, dataStoreName, entryKey } = req.query;

	if (!universeId || !dataStoreName || !entryKey) {
		return res.status(400).json({ success: false, error: "Missing query params" });
	}
	if (!ROBLOX_API_KEY) return res.status(500).json({ success: false, error: "ROBLOX_API_KEY not configured" });

	try {
		const url = `${BASE_URL}/${universeId}/standard-datastores/datastore/entries/entry?dataStoreName=${encodeURIComponent(dataStoreName)}&id=${encodeURIComponent(entryKey)}`;
		const response = await fetch(url, { method: 'GET', headers: { 'x-api-key': ROBLOX_API_KEY } });

		if (response.status === 404) return res.json({ success: true, body: "" });
		if (!response.ok) {
			const errText = await response.text();
			return res.status(response.status).json({ success: false, error: `Roblox API ${response.status}: ${errText}` });
		}
		const body = await response.text();
		return res.json({ success: true, body: body });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.post('/api/datastore', async (req, res) => {
	const { universeId, dataStoreName, entryKey } = req.query;

	if (!universeId || !dataStoreName || !entryKey) {
		return res.status(400).json({ success: false, error: "Missing query params" });
	}
	if (!ROBLOX_API_KEY) return res.status(500).json({ success: false, error: "ROBLOX_API_KEY not configured" });

	try {
		const url = `${BASE_URL}/${universeId}/standard-datastores/datastore/entries/entry?dataStoreName=${encodeURIComponent(dataStoreName)}&id=${encodeURIComponent(entryKey)}`;
		const response = await fetch(url, {
			method: 'POST',
			headers: { 'x-api-key': ROBLOX_API_KEY, 'content-type': 'application/json' },
			body: req.body ? JSON.stringify(req.body) : ''
		});

		if (!response.ok) {
			const errText = await response.text();
			return res.status(response.status).json({ success: false, error: `Roblox API ${response.status}: ${errText}` });
		}
		const body = await response.text();
		return res.json({ success: true, body: body });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.delete('/api/datastore', async (req, res) => {
	const { universeId, dataStoreName, entryKey } = req.query;

	if (!universeId || !dataStoreName || !entryKey) {
		return res.status(400).json({ success: false, error: "Missing query params" });
	}
	if (!ROBLOX_API_KEY) return res.status(500).json({ success: false, error: "ROBLOX_API_KEY not configured" });

	try {
		const url = `${BASE_URL}/${universeId}/standard-datastores/datastore/entries/entry?dataStoreName=${encodeURIComponent(dataStoreName)}&id=${encodeURIComponent(entryKey)}`;
		const response = await fetch(url, { method: 'DELETE', headers: { 'x-api-key': ROBLOX_API_KEY } });

		if (!response.ok) {
			const errText = await response.text();
			return res.status(response.status).json({ success: false, error: `Roblox API ${response.status}: ${errText}` });
		}
		return res.json({ success: true, body: "" });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

// FIX: Ràng buộc cổng 0.0.0.0 cho các nền tảng Cloud (Railway)
app.listen(port, '0.0.0.0', () => {
	console.log(`Server đang chạy trên cổng ${port}`);
	if (!ROBLOX_API_KEY) {
		console.warn('CẢNH BÁO: ROBLOX_API_KEY chưa được set!');
	}
});