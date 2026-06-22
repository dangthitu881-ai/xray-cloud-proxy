const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb', verify: (req, res, buf, encoding) => {
	// Capture raw body for debugging without consuming the stream
	req.rawBody = buf.toString(encoding || 'utf8');
	if (req.url && req.url.includes('register')) {
		console.log('[RAW BODY]', JSON.stringify(req.rawBody).slice(0, 500));
	}
} }));

// Handle JSON parse errors — return JSON instead of HTML
app.use((err, req, res, next) => {
	if (err.type === 'entity.parse.error' || err.status === 400) {
		console.error('[JSON PARSE ERROR]', err.message, '| Body type:', typeof req.body, '| Raw body length:', req.headers['content-length']);
		return res.status(400).json({ success: false, error: 'Invalid JSON body: ' + err.message });
	}
	next(err);
});

// ===== CONFIG =====
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'changeme';
const BASE_URL = 'https://apis.roblox.com/datastores/v1/universes';
const DATASTORE_NAME = 'XRay_HubProjects';
const DEFAULT_UNIVERSE_ID = '8918651601';

// ===== DATASTORE HELPERS =====
async function dsGet(entryKey) {
	const url = `${BASE_URL}/${DEFAULT_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`
		+ `?dataStoreName=${encodeURIComponent(DATASTORE_NAME)}`
		+ `&entryKey=${encodeURIComponent(entryKey)}`;
	console.log('[dsGet] URL:', url);
	const response = await fetch(url, {
		method: 'GET',
		headers: { 'x-api-key': ROBLOX_API_KEY }
	});
	console.log('[dsGet] Status:', response.status, response.statusText);
	if (response.status === 404) return null;
	if (!response.ok) {
		const errText = await response.text();
		console.error('[dsGet] Error body:', errText);
		throw new Error(`DS GET ${response.status}: ${errText}`);
	}
	const text = await response.text();
	try { return JSON.parse(text); } catch { return text; }
}

async function dsSet(entryKey, data) {
	const url = `${BASE_URL}/${DEFAULT_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`
		+ `?dataStoreName=${encodeURIComponent(DATASTORE_NAME)}`
		+ `&entryKey=${encodeURIComponent(entryKey)}`;
	const body = typeof data === 'string' ? data : JSON.stringify(data);
	console.log('[dsSet] URL:', url, '| Body length:', body.length);
	const response = await fetch(url, {
		method: 'POST',
		headers: { 'x-api-key': ROBLOX_API_KEY, 'content-type': 'application/json' },
		body: body
	});
	console.log('[dsSet] Status:', response.status, response.statusText);
	if (!response.ok) {
		const errText = await response.text();
		console.error('[dsSet] Error body:', errText);
		throw new Error(`DS POST ${response.status}: ${errText}`);
	}
	return true;
}

async function dsDelete(entryKey) {
	const url = `${BASE_URL}/${DEFAULT_UNIVERSE_ID}/standard-datastores/datastore/entries/entry`
		+ `?dataStoreName=${encodeURIComponent(DATASTORE_NAME)}`
		+ `&entryKey=${encodeURIComponent(entryKey)}`;
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
	console.log('[REGISTER] Body:', JSON.stringify(req.body), '| Content-Type:', req.headers['content-type']);
	console.log('[REGISTER] Raw body:', req.rawBody ? JSON.stringify(req.rawBody).slice(0, 500) : 'NO RAW BODY');
	let { username, lookingFor } = req.body || {};

	console.log('[REGISTER] username:', JSON.stringify(username), '| type:', typeof username, '| lookingFor:', JSON.stringify(lookingFor), '| type:', typeof lookingFor);
	console.log('[REGISTER] req.body keys:', Object.keys(req.body || {}), '| raw body length:', req.headers['content-length']);

	if (!username || typeof username !== 'string') {
		console.log('[REGISTER] FAIL: username is', username === undefined ? 'undefined' : username === null ? 'null' : typeof username, JSON.stringify(username));
		return res.status(400).json({ success: false, error: 'Invalid username format' });
	}

	if (username.length < 3 || username.length > 20) {
		return res.status(400).json({ success: false, error: 'Username must be 3-20 characters' });
	}

	// Clean username: strip @ prefix and invisible characters
	username = username.replace(/^[\s@]+|[\s\u200B-\u200F\uFEFF]+$/g, '');
	if (!/^[a-zA-Z0-9_.]+$/.test(username)) {
		return res.status(400).json({ success: false, error: 'Username can only contain letters, numbers, underscores, and dots' });
	}

	try {
		// Use individual key per user instead of single _users key
		const existingUser = await dsGet(`user_${username}`);

		if (existingUser) {
			if (existingUser.status === 'approved') return res.status(409).json({ success: false, error: 'Username already taken' });
			if (existingUser.status === 'pending') return res.status(409).json({ success: false, error: 'Registration already pending approval' });
			if (existingUser.status === 'denied') return res.status(403).json({ success: false, error: 'Registration was denied. Contact admin.' });
			return res.status(409).json({ success: false, error: 'Username already taken' });
		}

		const newUser = {
			status: 'pending',
			lookingFor: lookingFor || '',
			createdAt: Date.now()
		};

		await dsSet(`user_${username}`, newUser);
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
		// Use individual key per user
		const user = await dsGet(`user_${username}`);

		if (!user) return res.status(404).json({ success: false, error: 'Account not found. Please register first.' });
		if (user.status === 'pending') return res.status(403).json({ success: false, error: 'Account pending approval. Please wait.' });
		if (user.status === 'denied') return res.status(403).json({ success: false, error: 'Account was denied. Contact admin.' });

		// Use individual key per token instead of single _tokens key
		const token = generateToken();
		await dsSet(`token_${token}`, { username, createdAt: Date.now() });

		return res.json({ success: true, token: token, username: username });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.get('/api/auth/status', async (req, res) => {
	const { username } = req.query;
	if (!username) return res.status(400).json({ success: false, error: 'Missing username' });

	try {
		// Use individual key per user
		const user = await dsGet(`user_${username}`);
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
		// Use individual key per token
		const session = await dsGet(`token_${token}`);
		if (session) {
			await dsDelete(`token_${token}`);
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
		// Use individual key per token
		const session = await dsGet(`token_${token}`);

		if (!session) return res.status(401).json({ success: false, error: 'Invalid or expired token' });

		return res.json({ success: true, valid: true, username: session.username });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

// ===== DISCORD OAUTH2 ENDPOINTS (Đoạn thêm mới 100% không chạm tới code cũ) =====
app.get('/api/auth/discord/callback', async (req, res) => {
	const { code } = req.query;

	if (!code) {
		return res.status(400).send('❌ Không tìm thấy mã xác thực (code) từ Discord bro ơi!');
	}

	try {
		// 1. Đóng gói dữ liệu gửi lên Discord để lấy Token
		const data = new URLSearchParams();
		data.append('client_id', '1518476229517250612'); // Client ID chuẩn của bot bro
		data.append('client_secret', process.env.DISCORD_CLIENT_SECRET || ''); // Cần add biến này trên Railway sau khi vượt được 2FA
		data.append('grant_type', 'authorization_code');
		data.append('code', code);
		data.append('redirect_uri', 'https://xray-cloud-proxy-production.up.railway.app/api/auth/discord/callback');

		const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
			method: 'POST',
			body: data,
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
		});

		if (!tokenResponse.ok) {
			const errText = await tokenResponse.text();
			console.error('[DISCORD OAUTH ERROR]', errText);
			// Nếu chưa có Client Secret nó sẽ văng lỗi ở đây
			return res.status(400).send(`❌ Lỗi cấp quyền Discord: Cần cấu hình DISCORD_CLIENT_SECRET trên server.`);
		}

		const tokenData = await tokenResponse.json();
		const accessToken = tokenData.access_token;

		// 2. Dùng Token vừa lấy để moi thông tin user (ID, Tên)
		const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
			method: 'GET',
			headers: { Authorization: `Bearer ${accessToken}` }
		});

		if (!userResponse.ok) {
			throw new Error(`Không lấy được thông tin User từ Discord!`);
		}

		const discordUser = await userResponse.json();
		console.log(`[OAUTH2 SUCCESS] User đăng nhập: ${discordUser.username} | ID: ${discordUser.id}`);

		// 3. Trả về cái giao diện xịn xò cho người chơi ăn mừng
		res.send(`
			<html>
			<head>
				<meta charset="UTF-8">
				<title>Xác thực thành công</title>
				<style>
					body { background-color: #2b2d31; color: white; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
					.container { background-color: #313338; padding: 40px; border-radius: 8px; text-align: center; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 1px solid #1e1f22; }
					h1 { color: #57F287; margin-bottom: 10px;}
					p { color: #b5bac1; line-height: 1.5;}
					.user-info { margin-top: 20px; background: #1e1f22; padding: 15px; border-radius: 5px; font-weight: bold; }
				</style>
			</head>
			<body>
				<div class="container">
					<h1>🎉 Đăng nhập Discord thành công!</h1>
					<div class="user-info">
						User: ${discordUser.username} <br>
						ID: ${discordUser.id}
					</div>
					<p style="margin-top: 25px;">Hệ thống đã nhận diện được tài khoản của bạn.<br>Vui lòng quay lại game Roblox để tiếp tục nha bro!</p>
				</div>
			</body>
			</html>
		`);

	} catch (error) {
		console.error('[OAUTH2 FATAL ERROR]', error.message);
		res.status(500).send(`❌ Đã có lỗi xảy ra trong quá trình kết nối với Discord: ${error.message}`);
	}
});

// ===== ADMIN ENDPOINTS =====
app.post('/api/admin/approve', async (req, res) => {
	const { username, secret } = req.body;
	if (!secret || secret !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized' });
	if (!username) return res.status(400).json({ success: false, error: 'Missing username' });

	try {
		// Use individual key per user
		const user = await dsGet(`user_${username}`);
		if (!user) return res.status(404).json({ success: false, error: 'User not found' });
		if (user.status === 'approved') return res.status(409).json({ success: false, error: 'Already approved' });

		user.status = 'approved';
		user.approvedAt = Date.now();
		await dsSet(`user_${username}`, user);
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
		// Use individual key per user
		const user = await dsGet(`user_${username}`);
		if (!user) return res.status(404).json({ success: false, error: 'User not found' });

		user.status = 'denied';
		user.deniedAt = Date.now();
		await dsSet(`user_${username}`, user);
		return res.json({ success: true, message: username + ' denied' });
	} catch (err) {
		return res.status(500).json({ success: false, error: err.message });
	}
});

app.get('/api/admin/pending', async (req, res) => {
	const secret = req.query.secret;
	if (!secret || secret !== ADMIN_SECRET) return res.status(401).json({ success: false, error: 'Unauthorized' });

	try {
		// List all user_ keys, then fetch each to check status
		const keys = await dsList('user_');
		const pending = {};
		for (const key of keys) {
			const userData = await dsGet(key.id);
			if (userData && userData.status === 'pending') {
				const name = key.id.replace('user_', '');
				pending[name] = { lookingFor: userData.lookingFor, createdAt: userData.createdAt };
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

// ===== START SERVER =====
app.listen(port, '0.0.0.0', () => {
	console.log(`Server dang chay tren cong ${port}`);
	if (!ROBLOX_API_KEY) {
		console.warn('CANH BAO: ROBLOX_API_KEY chua duoc set!');
	}
});