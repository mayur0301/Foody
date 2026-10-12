/**
 * Handles pagination for Mongoose queries
 * @param {Object} query - req.query object
 * @param {Number} totalItems - Total count of documents
 * @returns {Object} - { skip, limit, paginationMeta }
 */
const getPagination = (query, totalItems) => {
    const page = parseInt(query.page, 10) || 1;
    const limit = parseInt(query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const totalPages = Math.ceil(totalItems / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return {
        skip,
        limit,
        meta: {
            totalItems,
            itemCount: Math.min(limit, totalItems - skip),
            itemsPerPage: limit,
            totalPages,
            currentPage: page,
            hasNextPage,
            hasPrevPage,
            nextPage: hasNextPage ? page + 1 : null,
            prevPage: hasPrevPage ? page - 1 : null
        }
    };
};

module.exports = getPagination;
