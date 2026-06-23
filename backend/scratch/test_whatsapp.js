const whatsapp = require('../skills/whatsapp');
console.log("Starting WhatsApp client isolation test...");
whatsapp.initWhatsApp();
setInterval(async () => {
  const status = await whatsapp.execute({ action: 'status' });
  console.log("Current status:", status);
}, 5000);
