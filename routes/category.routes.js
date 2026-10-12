const express = require('express')
const router = express.Router()

const {
  createCategory,
  getCategories,
  updateCategory,
  deleteCategory,
  getAllCategories,
  getCategoriesByHotel
} = require('../controllers/category.controller')

const authenticate = require('../middleware/auth')
const allowRoles = require('../middleware/allowedRoles')
const checkLimit = require('../middleware/checkLimit')
const { ROLES } = require('../utils/constants')
const Category = require('../models/Category')

router.use(authenticate)

// ── Create Category: Check maxCategories limit ──
router.post('/',
  allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN, ROLES.STAFF),
  checkLimit('maxCategories', (req) => Category.countDocuments({ hotel: req.user.hotel })),
  createCategory
)

router.get('/', getCategories)
router.get('/all', allowRoles(ROLES.SUPER_ADMIN), getAllCategories)
router.get('/hotel/:hotelId', allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN), getCategoriesByHotel)

router.put('/update/:id', allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN, ROLES.STAFF), updateCategory)
router.delete('/delete/:id', allowRoles(ROLES.SUPER_ADMIN, ROLES.HOTEL_ADMIN, ROLES.STAFF), deleteCategory)

module.exports = router
