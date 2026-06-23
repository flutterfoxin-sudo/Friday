const express = require('express');
const app = express();
app.use(express.json());
app.post('/api/whatsapp/reply', (req, res) => {
    console.log("RECEIVED POST:", req.body);
    res.json({success: true, message: "Mock message sent"});
});
app.listen(3000, () => console.log('Mock server on 3000'));
