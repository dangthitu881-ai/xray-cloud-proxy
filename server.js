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