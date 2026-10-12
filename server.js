require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 3000;
const { startSubscriptionCron } = require('./scripts/subscriptionCron');

connectDB();
startSubscriptionCron();


app.listen(PORT, () => {

  console.log(`Server running on port ${PORT}`);
});