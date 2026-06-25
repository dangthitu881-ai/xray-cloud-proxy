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
		// Sanitize DataStore entry key (dots not allowed)
		function dsKey(prefix, name) {
			return prefix + name.replace(/\./g, '_');
		}

				async function dsList(prefix) {
					let allKeys = [];
					let cursor = '';
					let page = 0;
					while (true) {
						let url = `${BASE_URL}/${DEFAULT_UNIVERSE_ID}/standard-datastores/datastore/entries`
						+ `?dataStoreName=${encodeURIComponent(DATASTORE_NAME)}`
						+ `&prefix=${encodeURIComponent(prefix)}`
						+ `&limit=100`;
						if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
							console.log('[dsList] Page', page, 'URL:', url);
							const response = await fetch(url, {
								method: 'GET',
								headers: { 'x-api-key': ROBLOX_API_KEY }
							});
							console.log('[dsList] Page', page, 'Status:', response.status);
							if (!response.ok) {
								const errText = await response.text();
								console.error('[dsList] Error body:', errText);
								throw new Error(`DS LIST ${response.status}: ${errText}`);
								}
								const data = await response.json();
								const rawKeys = data.keys || [];
								console.log('[dsList] Page', page, 'raw keys sample:', JSON.stringify(rawKeys.slice(0, 3)));
								// Normalize: Roblox API may return {id:...} or just strings
								const normalized = rawKeys.map(k => {
									if (typeof k === 'string') return { id: k };
									if (k.id) return k;
										if (k.key) return { id: k.key };
											if (k.name) return { id: k.name };
												console.error('[dsList] Unknown key format:', JSON.stringify(k));
												return { id: null };
								});
								allKeys = allKeys.concat(normalized);
								cursor = data.nextPageCursor || '';
								if (!cursor) break;
									page++;
									}
						console.log('[dsList] Total keys for prefix', prefix + ':', allKeys.length);
						return allKeys;
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
										content: `🆕 **New Registration Request**`,
										embeds: [{
											title: 'New User Registration',
											fields: [
											{ name: 'Username', value: username, inline: true },
											{ name: 'Looking For', value: lookingFor || 'N/A', inline: true },
											{ name: 'Status', value: '⏳ Pending', inline: true }
											],
											color: 16776960,
											timestamp: new Date().toISOString()
										}],
										components: [
										{
											type: 1,
											components: [
											{
												type: 2,
												style: 3,
												label: '✅ Approve',
												custom_id: `approve_${username}`
											},
											{
												type: 2,
												style: 4,
												label: '❌ Deny',
												custom_id: `deny_${username}`
											},
											{
												type: 2,
												style: 2,
												label: '🚩 Flag',
												custom_id: `flag_${username}`
											}
											]
										}
										]
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
		let { username, lookingFor, tier } = req.body || {};

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
						const existingUser = await dsGet(`dsKey('user_', username)`);

						if (existingUser) {
							if (existingUser.status === 'approved') return res.status(409).json({ success: false, error: 'Username already taken' });
							if (existingUser.status === 'pending') return res.status(409).json({ success: false, error: 'Registration already pending approval' });
								if (existingUser.status === 'denied') return res.status(403).json({ success: false, error: 'Registration was denied. Contact admin.' });
									return res.status(409).json({ success: false, error: 'Username already taken' });
									}

							const newUser = {
								status: 'pending',
								lookingFor: lookingFor || '',
								tier: tier || 'standard',
								createdAt: Date.now()
							};

							await dsSet(`dsKey('user_', username)`, newUser);
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
				const user = await dsGet(`dsKey('user_', username)`);

				if (!user) return res.status(404).json({ success: false, error: 'Account not found. Please register first.' });
					if (user.status === 'pending') return res.status(403).json({ success: false, error: 'Account pending approval. Please wait.' });
						if (user.status === 'denied') return res.status(403).json({ success: false, error: 'Account was denied. Contact admin.' });
							if (user.status === 'banned') return res.status(403).json({ success: false, error: 'Account is banned. Contact admin.' });

								// Use individual key per token instead of single _tokens key
								const token = generateToken();
								await dsSet(`dsKey('token_', token)`, { username, createdAt: Date.now() });

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
				const user = await dsGet(`dsKey('user_', username)`);
				if (!user) return res.json({ success: true, exists: false });
					const resp = { success: true, exists: true, status: user.status, tier: user.tier || 'standard' };
					if (user.generatedAccount) {
						resp.generatedAccount = user.generatedAccount;
					}
					return res.json(resp);
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
				const session = await dsGet(`dsKey('token_', token)`);
				if (session) {
					await dsDelete(`dsKey('token_', token)`);
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
				const session = await dsGet(`dsKey('token_', token)`);

				if (!session) return res.status(401).json({ success: false, error: 'Invalid or expired token' });

					return res.json({ success: true, valid: true, username: session.username });
			} catch (err) {
				return res.status(500).json({ success: false, error: err.message });
			}
	});

	// ===== ADMIN AUTH MIDDLEWARE =====
	function adminAuth(req, res, next) {
		const secret = req.body?.secret || req.query?.secret || req.headers?.['x-admin-secret'];
		if (!secret || secret !== ADMIN_SECRET) {
			return res.status(401).json({ success: false, error: 'Unauthorized' });
			}
			next();
			}

		// ===== ADMIN ENDPOINTS =====

		// Approve a pending user
		app.post('/api/admin/approve', adminAuth, async (req, res) => {
			const { username } = req.body;
			if (!username) return res.status(400).json({ success: false, error: 'Missing username' });

				try {
					const user = await dsGet(`dsKey('user_', username)`);
					if (!user) return res.status(404).json({ success: false, error: 'User not found' });
						if (user.status === 'approved') return res.status(409).json({ success: false, error: 'Already approved' });

							user.status = 'approved';
							user.approvedAt = Date.now();
							// Auto-generate account for standard tier
							if (user.tier === 'standard') {
								const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
								const accName = 'XRay_' + username + '_' + suffix;
								const accPass = crypto.randomBytes(8).toString('hex');
								user.generatedAccount = { name: accName, password: accPass };
							}
							await dsSet(`dsKey('user_', username)`, user);
							return res.json({ success: true, message: username + ' approved', generatedAccount: user.generatedAccount || null });
				} catch (err) {
					return res.status(500).json({ success: false, error: err.message });
				}
		});

		// Deny a pending user
		app.post('/api/admin/deny', adminAuth, async (req, res) => {
			const { username, reason } = req.body;
			if (!username) return res.status(400).json({ success: false, error: 'Missing username' });

				try {
					const user = await dsGet(`dsKey('user_', username)`);
					if (!user) return res.status(404).json({ success: false, error: 'User not found' });

						user.status = 'denied';
						user.deniedAt = Date.now();
						if (reason) user.denyReason = reason;
							await dsSet(`dsKey('user_', username)`, user);
							return res.json({ success: true, message: username + ' denied' });
				} catch (err) {
					return res.status(500).json({ success: false, error: err.message });
				}
		});

		// Flag a user (mark for review with reason)
		app.post('/api/admin/flag', adminAuth, async (req, res) => {
			const { username, reason } = req.body;
			if (!username) return res.status(400).json({ success: false, error: 'Missing username' });
				if (!reason) return res.status(400).json({ success: false, error: 'Missing flag reason' });

					try {
						const user = await dsGet(`dsKey('user_', username)`);
						if (!user) return res.status(404).json({ success: false, error: 'User not found' });

							if (!user.flags) user.flags = [];
								user.flags.push({ reason, flaggedAt: Date.now() });
								await dsSet(`dsKey('user_', username)`, user);
								return res.json({ success: true, message: username + ' flagged', flags: user.flags });
					} catch (err) {
						return res.status(500).json({ success: false, error: err.message });
					}
		});

		// Ban a user
		app.post('/api/admin/ban', adminAuth, async (req, res) => {
			const { username, reason } = req.body;
			if (!username) return res.status(400).json({ success: false, error: 'Missing username' });

				try {
					const user = await dsGet(`dsKey('user_', username)`);
					if (!user) return res.status(404).json({ success: false, error: 'User not found' });

						user.status = 'banned';
						user.bannedAt = Date.now();
						if (reason) user.banReason = reason;
							await dsSet(`dsKey('user_', username)`, user);
							// Also invalidate any active tokens for this user
								const keys = await dsList('token_');
								for (const key of keys) {
									const session = await dsGet(key.id);
									if (session && session.username === username) {
										await dsDelete(key.id);
										}
										}
									return res.json({ success: true, message: username + ' banned' });
				} catch (err) {
					return res.status(500).json({ success: false, error: err.message });
				}
		});

		// Unban a user (set back to approved)
		app.post('/api/admin/unban', adminAuth, async (req, res) => {
			const { username } = req.body;
			if (!username) return res.status(400).json({ success: false, error: 'Missing username' });

				try {
					const user = await dsGet(`dsKey('user_', username)`);
					if (!user) return res.status(404).json({ success: false, error: 'User not found' });
						if (user.status !== 'banned') return res.status(409).json({ success: false, error: 'User is not banned' });

							user.status = 'approved';
							user.unbannedAt = Date.now();
							delete user.banReason;
							await dsSet(`dsKey('user_', username)`, user);
							return res.json({ success: true, message: username + ' unbanned' });
				} catch (err) {
					return res.status(500).json({ success: false, error: err.message });
				}
		});

		// Delete a user completely
		app.post('/api/admin/delete', adminAuth, async (req, res) => {
			const { username } = req.body;
			if (!username) return res.status(400).json({ success: false, error: 'Missing username' });

				try {
					const user = await dsGet(`dsKey('user_', username)`);
					if (!user) return res.status(404).json({ success: false, error: 'User not found' });

						await dsDelete(`dsKey('user_', username)`);
						// Also invalidate any active tokens
						const keys = await dsList('token_');
						for (const key of keys) {
							const session = await dsGet(key.id);
							if (session && session.username === username) {
								await dsDelete(key.id);
								}
								}
							return res.json({ success: true, message: username + ' deleted' });
				} catch (err) {
					return res.status(500).json({ success: false, error: err.message });
				}
		});

		// Update user info (e.g. change lookingFor, add notes)
		app.post('/api/admin/update', adminAuth, async (req, res) => {
			const { username, updates } = req.body;
			if (!username) return res.status(400).json({ success: false, error: 'Missing username' });
				if (!updates || typeof updates !== 'object') return res.status(400).json({ success: false, error: 'Missing updates object' });

					try {
						const user = await dsGet(`dsKey('user_', username)`);
						if (!user) return res.status(404).json({ success: false, error: 'User not found' });

							// Only allow updating safe fields
							const allowedFields = ['lookingFor', 'notes', 'displayName'];
							for (const field of allowedFields) {
								if (updates[field] !== undefined) {
									user[field] = updates[field];
								}
								}
								user.updatedAt = Date.now();
								await dsSet(`dsKey('user_', username)`, user);
								return res.json({ success: true, message: username + ' updated', user });
					} catch (err) {
						return res.status(500).json({ success: false, error: err.message });
					}
		});

		// Get specific user details
		app.get('/api/admin/user/:username', adminAuth, async (req, res) => {
			const { username } = req.params;
			if (!username) return res.status(400).json({ success: false, error: 'Missing username' });

				try {
					const user = await dsGet(`dsKey('user_', username)`);
					if (!user) return res.status(404).json({ success: false, error: 'User not found' });
						return res.json({ success: true, username, user });
				} catch (err) {
					return res.status(500).json({ success: false, error: err.message });
				}
		});

		// List pending users
		app.get('/api/admin/pending', adminAuth, async (req, res) => {
			try {
				console.log('[ADMIN/PENDING] Starting dsList for user_ prefix...');
				const keys = await dsList('user_');
				console.log('[ADMIN/PENDING] dsList returned', keys.length, 'keys');
				const pending = {};
				for (const key of keys) {
					const entryKey = key.id || key.key || key.name || key;
					if (!entryKey || typeof entryKey !== 'string') {
						console.warn('[ADMIN/PENDING] Skipping invalid key:', JSON.stringify(key));
						continue;
						}
						console.log('[ADMIN/PENDING] Checking entryKey:', entryKey);
						const userData = await dsGet(entryKey);
						console.log('[ADMIN/PENDING] userData for', entryKey, ':', JSON.stringify(userData));
						if (userData && userData.status === 'pending') {
							const name = entryKey.replace('user_', '');
							pending[name] = { lookingFor: userData.lookingFor, createdAt: userData.createdAt };
							console.log('[ADMIN/PENDING] Found pending user:', name);
							}
							}
					console.log('[ADMIN/PENDING] Returning', Object.keys(pending).length, 'pending users');
					return res.json({ success: true, pending });
			} catch (err) {
				console.error('[ADMIN/PENDING] Error:', err.message);
				return res.status(500).json({ success: false, error: err.message });
			}
		});

		// Debug: raw DataStore list test
		app.get('/api/admin/debug/dslist', adminAuth, async (req, res) => {
			try {
				const keys = await dsList('user_');
				const details = [];
				const rawKeys = [];
				for (const key of keys) {
					const entryKey = key.id || key.key || key.name || (typeof key === 'string' ? key : null);
					rawKeys.push(JSON.stringify(key));
					const userData = entryKey ? await dsGet(entryKey) : null;
					details.push({ key: entryKey, status: userData?.status || 'null', data: userData });
					}
					return res.json({ success: true, keyCount: keys.length, rawKeys, details });
			} catch (err) {
				return res.status(500).json({ success: false, error: err.message });
			}
		});

		// List all users (with optional status filter)
		app.get('/api/admin/users', adminAuth, async (req, res) => {
			const statusFilter = req.query.status; // optional: pending, approved, denied, banned, flagged

			try {
				const keys = await dsList('user_');
				const users = {};
				for (const key of keys) {
					const userData = await dsGet(key.id);
					if (userData) {
						if (statusFilter && userData.status !== statusFilter) continue;
						const name = key.id.replace('user_', '');
						users[name] = {
							status: userData.status,
							lookingFor: userData.lookingFor,
							tier: userData.tier || 'standard',
							createdAt: userData.createdAt,
							flags: userData.flags || [],
							generatedAccount: userData.generatedAccount || null,
						};
						}
						}
					return res.json({ success: true, count: Object.keys(users).length, users });
			} catch (err) {
				return res.status(500).json({ success: false, error: err.message });
			}
		});

		// Export user log as plain text
		app.get('/api/admin/export/:username', adminAuth, async (req, res) => {
			const { username } = req.params;
			if (!username) return res.status(400).json({ success: false, error: 'Missing username' });

				try {
					const user = await dsGet(`dsKey('user_', username)`);
					if (!user) return res.status(404).json({ success: false, error: 'User not found' });

						let log = '=== XRay Hub Account Log ===\n';
						log += 'Username: ' + username + '\n';
						log += 'Status: ' + (user.status || 'unknown') + '\n';
						log += 'Tier: ' + (user.tier || 'standard') + '\n';
						log += 'Looking For: ' + (user.lookingFor || 'N/A') + '\n';
						log += 'Created: ' + (user.createdAt ? new Date(user.createdAt).toISOString() : 'N/A') + '\n';
						if (user.approvedAt) log += 'Approved: ' + new Date(user.approvedAt).toISOString() + '\n';
						if (user.generatedAccount) {
							log += 'Generated Account Name: ' + user.generatedAccount.name + '\n';
							log += 'Generated Account Password: ' + user.generatedAccount.password + '\n';
						}
						if (user.flags && user.flags.length > 0) {
							log += 'Flags:\n';
							for (const f of user.flags) {
								log += '  - ' + f.reason + ' (' + new Date(f.flaggedAt).toISOString() + ')\n';
							}
						}
						log += '=== End Log ===\n';
						res.setHeader('Content-Type', 'text/plain');
						res.setHeader('Content-Disposition', 'attachment; filename="' + username + '_log.txt"');
						return res.send(log);
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