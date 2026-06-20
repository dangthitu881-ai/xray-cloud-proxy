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

// ===== USER VERIFICATION PROXY (MỚI THÊM) =====
	// POST - Xác minh username Roblox có tồn tại hay không
app.post('/api/users/verify-username', async (req, res) => {
	const { username } = req.body;

	if (!username) {
		return res.json({ success: false, error: "Missing username in request body" });
		}

		try {
			// Gọi thẳng sang API của Roblox để check
			const response = await fetch('https://users.roblox.com/v1/usernames/users', {
				method: 'POST',
				headers: {
					'content-type': 'application/json'
				},
				body: JSON.stringify({
					usernames: [username],
					excludeBannedUsers: true
				})
			});

			if (!response.ok) {
				const errText = await response.text();
				return res.json({ success: false, error: `Roblox Users API ${response.status}: ${errText}` });
				}

				const data = await response.json();

				// Roblox trả về một mảng nằm trong object "data"
				if (data.data && data.data.length > 0) {
					const user = data.data[0];
					// Trả về đúng định dạng chuẩn như client của bro chờ sẵn
					return res.json({
						success: true,
						found: true,
						id: user.id,
						displayName: user.displayName
					});
					} else {
	// Không tìm thấy user nào khớp
	return res.json({
		success: true,
		found: false
	});
	}

	} catch (err) {
	// Xử lý khi lỗi kết nối, proxy sập mạng... 
	// Trả về success: false để client nhận biết và kích hoạt cơ chế cảnh báo (không chặn user)
	return res.json({ success: false, error: err.message });
}
});

// ===== AUTH ENDPOINTS (NO PASSWORD - Discord webhook moderation) =====

// POST /api/auth/register - Đăng ký (chờ admin duyệt qua Discord)
app.post('/api/auth/register', async (req, res) => {
	let { username, lookingFor } = req.body;

	if (!username || username.length < 3 || username.length > 20) {
		return res.json({ success: false, error: 'Username must be 3-20 characters' });
	}
	// Strip @ prefix, whitespace, and invisible characters
	username = username.replace(/^[\s@]+|[\s\u200B-\u200F\uFEFF]+$/g, '');
	if (!/^[a-zA-Z0-9_.]+$/.test(username)) {
		return res.json({ success: false, error: 'Username can only contain letters, numbers, underscores, and dots' });
	}

	try {
		const users = (await dsGet('_users')) || {};

		if (users[username]) {
			if (users[username].status === 'approved') {
				return res.json({ success: false, error: 'Username already taken' });
			}
			if (users[username].status === 'pending') {
				return res.json({ success: false, error: 'Registration already pending approval' });
			}
			if (users[username].status === 'denied') {
				return res.json({ success: false, error: 'Registration was denied. Contact admin.' });
			}
			return res.json({ success: false, error: 'Username already taken' });
		}

		users[username] = {
			status: 'pending',
			lookingFor: lookingFor || '',
			createdAt: Date.now()
		};

		await dsSet('_users', users);

		// Gửi thông báo Discord webhook
		sendDiscordNotification(username, lookingFor);

		return res.json({
			success: true,
			status: 'pending',
			message: 'Registration submitted! Waiting for admin approval via Discord.'
		});
	} catch (err) {
		return res.json({ success: false, error: err.message });
	}
});

// POST /api/auth/login - Đăng nhập (không cần mật khẩu, chỉ cần username)
app.post('/api/auth/login', async (req, res) => {
	const { username } = req.body;

	if (!username) {
		return res.json({ success: false, error: 'Missing username' });
	}

	try {
		const users = (await dsGet('_users')) || {};
		const user = users[username];

		if (!user) {
			return res.json({ success: false, error: 'Account not found. Please register first.' });
		}
		if (user.status === 'pending') {
			return res.json({ success: false, error: 'Account pending approval. Please wait for admin to approve.' });
		}
		if (user.status === 'denied') {
			return res.json({ success: false, error: 'Account was denied. Contact admin.' });
		}

		// status === 'approved' → tạo token
		const token = generateToken();
		const tokens = (await dsGet('_tokens')) || {};
		tokens[token] = { username, createdAt: Date.now() };
		await dsSet('_tokens', tokens);

		return res.json({
			success: true,
			token: token,
			username: username
		});
	} catch (err) {
		return res.json({ success: false, error: err.message });
	}
});

// GET /api/auth/status - Kiểm tra trạng thái tài khoản
app.get('/api/auth/status', async (req, res) => {
	const { username } = req.query;
	if (!username) return res.json({ success: false, error: 'Missing username' });
	try {
		const users = (await dsGet('_users')) || {};
		const user = users[username];
		if (!user) return res.json({ success: true, exists: false });
		return res.json({ success: true, exists: true, status: user.status });
	} catch (err) {
		return res.json({ success: false, error: err.message });
	}
});

// POST /api/auth/logout - Đăng xuất
app.post('/api/auth/logout', async (req, res) => {
	const authHeader = req.headers['authorization'];
	const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

	if (!token) {
		return res.json({ success: false, error: 'Missing token' });
	}

	try {
		const tokens = (await dsGet('_tokens')) || {};
		if (tokens[token]) {
			delete tokens[token];
			await dsSet('_tokens', tokens);
		}
		return res.json({ success: true });
	} catch (err) {
		return res.json({ success: false, error: err.message });
	}
});

// GET /api/auth/verify - Kiểm tra token còn hợp lệ không
app.get('/api/auth/verify', async (req, res) => {
	const authHeader = req.headers['authorization'];
	const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

	if (!token) {
		return res.json({ success: false, error: 'Missing token' });
	}

	try {
		const tokens = (await dsGet('_tokens')) || {};
		const session = tokens[token];

		if (!session) {
			return res.json({ success: false, error: 'Invalid or expired token' });
		}

		return res.json({
			success: true,
			valid: true,
			username: session.username
		});
	} catch (err) {
		return res.json({ success: false, error: err.message });
	}
});

// ===== ADMIN ENDPOINTS (Duyệt tài khoản qua Discord) =====

// POST /api/admin/approve - Duyệt user
app.post('/api/admin/approve', async (req, res) => {
	const { username, secret } = req.body;
	if (!secret || secret !== ADMIN_SECRET) {
		return res.json({ success: false, error: 'Unauthorized' });
	}
	if (!username) return res.json({ success: false, error: 'Missing username' });
	try {
		const users = (await dsGet('_users')) || {};
		if (!users[username]) return res.json({ success: false, error: 'User not found' });
		if (users[username].status === 'approved') return res.json({ success: false, error: 'Already approved' });
		users[username].status = 'approved';
		users[username].approvedAt = Date.now();
		await dsSet('_users', users);
		return res.json({ success: true, message: username + ' approved' });
	} catch (err) {
		return res.json({ success: false, error: err.message });
	}
});

// POST /api/admin/deny - Từ chối user
app.post('/api/admin/deny', async (req, res) => {
	const { username, secret } = req.body;
	if (!secret || secret !== ADMIN_SECRET) {
		return res.json({ success: false, error: 'Unauthorized' });
	}
	if (!username) return res.json({ success: false, error: 'Missing username' });
	try {
		const users = (await dsGet('_users')) || {};
		if (!users[username]) return res.json({ success: false, error: 'User not found' });
		users[username].status = 'denied';
		users[username].deniedAt = Date.now();
		await dsSet('_users', users);
		return res.json({ success: true, message: username + ' denied' });
	} catch (err) {
		return res.json({ success: false, error: err.message });
	}
});

// GET /api/admin/pending - Xem danh sách user chờ duyệt
app.get('/api/admin/pending', async (req, res) => {
	const secret = req.query.secret;
	if (!secret || secret !== ADMIN_SECRET) {
		return res.json({ success: false, error: 'Unauthorized' });
	}
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
		return res.json({ success: false, error: err.message });
	}
});

// ===== DATASTORE PROXY =====
	// GET - Đọc entry
app.get('/api/datastore', async (req, res) => {
	const { universeId, dataStoreName, entryKey } = req.query;

	if (!universeId || !dataStoreName || !entryKey) {
		return res.json({ success: false, error: "Missing query params: universeId, dataStoreName, entryKey" });
		}

		if (!ROBLOX_API_KEY) {
			return res.json({ success: false, error: "ROBLOX_API_KEY not configured on server" });
			}

			try {
				const url = `${BASE_URL}/${universeId}/standard-datastores/datastore/entries/entry`
					+ `?dataStoreName=${encodeURIComponent(dataStoreName)}`
					+ `&id=${encodeURIComponent(entryKey)}`;

				const response = await fetch(url, {
					method: 'GET',
					headers: { 'x-api-key': ROBLOX_API_KEY }
				});

				if (response.status === 404) {
					return res.json({ success: true, body: "" }); // Entry chưa tồn tại
					}

					if (!response.ok) {
						const errText = await response.text();
						return res.json({ success: false, error: `Roblox API ${response.status}: ${errText}` });
						}

						const body = await response.text();
						return res.json({ success: true, body: body });

			} catch (err) {
				return res.json({ success: false, error: err.message });
			}
});

// POST - Ghi entry
app.post('/api/datastore', async (req, res) => {
	const { universeId, dataStoreName, entryKey } = req.query;

	if (!universeId || !dataStoreName || !entryKey) {
		return res.json({ success: false, error: "Missing query params: universeId, dataStoreName, entryKey" });
		}

		if (!ROBLOX_API_KEY) {
			return res.json({ success: false, error: "ROBLOX_API_KEY not configured on server" });
			}

			try {
				const url = `${BASE_URL}/${universeId}/standard-datastores/datastore/entries/entry`
					+ `?dataStoreName=${encodeURIComponent(dataStoreName)}`
					+ `&id=${encodeURIComponent(entryKey)}`;

				const response = await fetch(url, {
					method: 'POST',
					headers: {
						'x-api-key': ROBLOX_API_KEY,
						'content-type': 'application/json'
					},
					body: req.body ? JSON.stringify(req.body) : ''
				});

				if (!response.ok) {
					const errText = await response.text();
					return res.json({ success: false, error: `Roblox API ${response.status}: ${errText}` });
					}

					const body = await response.text();
					return res.json({ success: true, body: body });

			} catch (err) {
				return res.json({ success: false, error: err.message });
			}
});

// DELETE - Xóa entry
app.delete('/api/datastore', async (req, res) => {
	const { universeId, dataStoreName, entryKey } = req.query;

	if (!universeId || !dataStoreName || !entryKey) {
		return res.json({ success: false, error: "Missing query params: universeId, dataStoreName, entryKey" });
		}

		if (!ROBLOX_API_KEY) {
			return res.json({ success: false, error: "ROBLOX_API_KEY not configured on server" });
			}

			try {
				const url = `${BASE_URL}/${universeId}/standard-datastores/datastore/entries/entry`
					+ `?dataStoreName=${encodeURIComponent(dataStoreName)}`
					+ `&id=${encodeURIComponent(entryKey)}`;

				const response = await fetch(url, {
					method: 'DELETE',
					headers: { 'x-api-key': ROBLOX_API_KEY }
				});

				if (!response.ok) {
					const errText = await response.text();
					return res.json({ success: false, error: `Roblox API ${response.status}: ${errText}` });
					}

					return res.json({ success: true, body: "" });

			} catch (err) {
				return res.json({ success: false, error: err.message });
			}
});

app.listen(port, () => {
	console.log(`Server đang chạy trên cổng ${port}`);
	if (!ROBLOX_API_KEY) {
		console.warn('CẢNH BÁO: ROBLOX_API_KEY chưa được set!');
		}
});