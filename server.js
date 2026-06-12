const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/api/health', (req, res) => {
    res.json({ status: "ok", configured: true });
});

app.listen(port, () => {
    console.log(`Server đang chạy trên cổng ${port}`);
});
