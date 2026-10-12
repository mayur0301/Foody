const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const swaggerUi = require('swagger-ui-express');
const specs = require('./config/swagger');
const authRoutes = require('./routes/AuthRoutes');
const profileRoutes = require('./routes/ProfileRoutes');
const receiptRoutes = require('./routes/ReceiptRoutes');
const orderRoutes = require('./routes/orderRoutes');
const dishRoutes = require('./routes/dish.routes');
const CategoryRoutes = require('./routes/category.routes');
const hotelRoutes = require('./routes/HotelRoutes');
const staffRoutes = require('./routes/StaffRoutes');
const dishSalesRoutes = require('./routes/dishSalesRoutes');
const planRoutes = require('./routes/planRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const adminRoutes = require('./routes/AdminRoutes');
const inventoryRoutes = require('./routes/inventoryRoutes');

const app = express();

// Middleware
const authenticate = require('./middleware/auth');
const allowRoles = require('./middleware/allowedRoles');
const { ROLES } = require('./utils/constants');

/* =======================
   CORS CONFIG
======================= */
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
];

const corsOptions = {
  origin: (origin, callback) => {
    // Normalizing origin to remove trailing slash for comparison
    const normalizedOrigin = origin ? origin.replace(/\/$/, '') : '';
    
    // Check if origin is allowed
    const isAllowed = !origin || 
      allowedOrigins.includes(normalizedOrigin) || 
      normalizedOrigin.startsWith('http://localhost') || 
      normalizedOrigin.endsWith('.vercel.app') ||
      normalizedOrigin.endsWith('.onrender.com');

    if (isAllowed) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-Setup-Key'],
};

// 1. Always apply CORS first
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Enable pre-flight for all routes

app.use(bodyParser.json());
app.use(express.static('public'));

app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(specs, {
    explorer: true,
    swaggerOptions: {
      persistAuthorization: true,
      tryItOutEnabled: true,
    },
    customCss: '.swagger-ui .topbar { background-color: #1a1a2e; }',
  })
);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/dish', dishRoutes);
app.use('/api/category', CategoryRoutes);
app.use('/api/hotels', hotelRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/dish-sales', dishSalesRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/inventory', inventoryRoutes);

const { getMyNotifications } = require('./controllers/NotificationController');
app.get('/api/notifications', authenticate, getMyNotifications);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// Global Error Handler
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const status = err.status || 'error';

  // Specific handling for common errors
  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      status: 'fail',
      message: `Invalid ${err.path}: ${err.value}`,
      errorCode: 'INVALID_ID'
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      success: false,
      status: 'fail',
      message: `Duplicate field entry: ${field}. Please use another value.`,
      errorCode: 'DUPLICATE_FIELD'
    });
  }

  res.status(statusCode).json({
    success: false,
    status: status,
    message: err.message,
  });
});

module.exports = app;