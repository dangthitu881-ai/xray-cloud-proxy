const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' })); // Tăng limit cho data lớn

// ===== API KEY - Set trên Railway biến môi trường =====
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY;
const BASE_URL = 'https://apis.roblox.com/datastores/v1/universes';

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => {
    res.json({
        status: "ok",
        configured: !!ROBLOX_API_KEY,
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