// models/Notification.js
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    message: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['INFO', 'WARNING', 'SUCCESS', 'ALERT','OFFER'],
        default: 'INFO'
    },
    target: {
        type: String,
        enum: ['ALL', 'HOTEL_ONLY', 'STAFF_ONLY', 'SPECIFIC_HOTEL'],
        default: 'ALL'
    },
    targetHotel: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    expiresAt: {
        type: Date
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
