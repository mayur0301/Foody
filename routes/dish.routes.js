const express = require('express')
const router = express.Router()
const multer = require('multer')

// Configure multer for memory storage
const storage = multer.memoryStorage()
const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Accept only Excel files
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true)
    } else {
      cb(new Error('Only Excel files are allowed'), false)
    }
  }
})

const {
  createDish,
  getDishes,
  updateDish,
  deleteDish,
  getDishesByCategory,
  bulkUploadDishes,
  getAllDishes,
  getDishesByHotel
} = require('../controllers/dish.controller')

const authenticate = require('../middleware/auth')
const allowRoles = require('../middleware/allowedRoles')
const requireFeature = require('../middleware/requireFeature')
const checkLimit = require('../middleware/checkLimit')
const { ROLES, FEATURES } = require('../utils/constants')
const Dish = require('../models/Dish')

router.use(authenticate)

// ── Create Dish: Check maxDishes limit ──
router.post('/',
  allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN, ROLES.STAFF),
  checkLimit('maxDishes', (req) => Dish.countDocuments({ hotel: req.user.hotel })),
  createDish
)

// ── Bulk Upload: Requires BULK_MENU_UPLOAD feature ──
router.post('/bulk-upload',
  allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN, ROLES.STAFF),
  requireFeature(FEATURES.BULK_MENU_UPLOAD),
  upload.single('file'),
  bulkUploadDishes
)

router.get('/', getDishes)
router.get('/all', allowRoles(ROLES.SUPER_ADMIN), getAllDishes)
router.get('/hotel/:hotelId', allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN), getDishesByHotel)

router.put('/:id', allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN, ROLES.STAFF), updateDish)
router.delete('/:id', allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN, ROLES.STAFF), deleteDish)

router.get('/category/:categoryId', getDishesByCategory)

module.exports = router
