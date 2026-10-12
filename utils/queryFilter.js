/**
 * Builds a Mongoose filter object from query params
 * Supports "daynation" (today, week, month, year) and custom fields
 * @param {Object} query - req.query object
 * @param {Array} allowedFields - Fields allowed for direct filtering
 * @param {String} dateField - Field name to use for date filtering (default: 'createdAt')
 * @returns {Object} - Mongoose filter object
 */
const buildFilter = (query, allowedFields = [], dateField = 'createdAt') => {
    let filter = {};

    // 1. Time-based filtering (Daynation)
    if (query.timeRange) {
        const now = new Date();
        const startOfToday = new Date(now.setHours(0, 0, 0, 0));

        switch (query.timeRange) {
            case 'today':
                filter[dateField] = { $gte: startOfToday };
                break;
            case 'week':
                const lastWeek = new Date(startOfToday);
                lastWeek.setDate(lastWeek.getDate() - 7);
                filter[dateField] = { $gte: lastWeek };
                break;
            case 'month':
                const lastMonth = new Date(startOfToday);
                lastMonth.setMonth(lastMonth.getMonth() - 1);
                filter[dateField] = { $gte: lastMonth };
                break;
            case 'year':
                const startOfYear = new Date(now.getFullYear(), 0, 1);
                filter[dateField] = { $gte: startOfYear };
                break;
            case 'custom':
                if (query.startDate || query.endDate) {
                    filter[dateField] = {};
                    if (query.startDate) filter[dateField].$gte = new Date(query.startDate);
                    if (query.endDate) filter[dateField].$lte = new Date(query.endDate);
                }
                break;
        }
    }

    // 2. Exact match filtering for allowed fields
    allowedFields.forEach(field => {
        if (query[field]) {
            filter[field] = query[field];
        }
    });

    // 3. Search filtering (case-insensitive)
    if (query.search && query.searchField) {
        filter[query.searchField] = { $regex: query.search, $options: 'i' };
    }

    return filter;
};

module.exports = buildFilter;
