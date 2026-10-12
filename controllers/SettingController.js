// controllers/SettingController.js
const Setting = require('../models/Setting');
const { logAction } = require('../utils/logger');

/**
 * @desc    Get all settings
 * @route   GET /api/admin/settings
 * @access  Private (Super Admin)
 */
exports.getSettings = async (req, res) => {
    try {
        const { category } = req.query;
        const filter = {};
        if (category) filter.category = category;

        const settings = await Setting.find(filter).sort({ category: 1, key: 1 });
        res.status(200).json({
            success: true,
            count: settings.length,
            data: settings
        });
    } catch (err) {
        console.error('GetSettings Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

/**
 * @desc    Update or Create setting
 * @route   POST /api/admin/settings
 * @access  Private (Super Admin)
 */
exports.updateSetting = async (req, res) => {
    try {
        const { key, value, description, category } = req.body;

        if (!key) return res.status(400).json({ success: false, message: 'Key is required' });

        const oldSetting = await Setting.findOne({ key });
        const setting = await Setting.findOneAndUpdate(
            { key },
            { value, description, category },
            { new: true, upsert: true, runValidators: true }
        );

        await logAction({
            action: 'SETTING_UPDATE',
            performedBy: req.user.id,
            entityType: 'SETTING',
            entityId: setting._id,
            changes: { before: oldSetting ? oldSetting.value : null, after: value }
        }, req);

        res.status(200).json({
            success: true,
            message: 'Setting updated successfully',
            data: setting
        });
    } catch (err) {
        console.error('UpdateSetting Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

/**
 * @desc    Get setting by key
 * @route   GET /api/admin/settings/:key
 * @access  Private (Super Admin)
 */
exports.getSettingByKey = async (req, res) => {
    try {
        const setting = await Setting.findOne({ key: req.params.key });
        if (!setting) {
            return res.status(404).json({ success: false, message: 'Setting not found' });
        }
        res.status(200).json({ success: true, data: setting });
    } catch (err) {
        console.error('GetSettingByKey Error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};
