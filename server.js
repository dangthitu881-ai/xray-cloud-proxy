const express = require('express');
const cors = require('cors'); // Nhập thư viện cors
const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); // Cho phép tất cả các nguồn truy cập
app.use(express.json());

app.get('/api/health', (req, res) => {
    res.json({ status: "ok", configured: true });
});

// Thêm cái này để nhận mọi request từ Roblox
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

app.listen(port, () => {
    console.log(`Server đang chạy trên cổng ${port}`);
});