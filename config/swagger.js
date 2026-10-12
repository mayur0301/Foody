const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.1.0',                     // Use latest stable
    info: {
      title: 'My API',
      version: '1.0.0',
      description: 'REST API for ...',
      contact: { name: 'Your Name', email: 'you@example.com' },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Development server' },
      { url: 'https://api.yourdomain.com', description: 'Production server' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: [
    './src/routes/*.js',                  // All route files
    './src/controllers/*.js',             // If you document there
    './src/models/*.js',                  // Optional: schemas from models
  ],
};

const specs = swaggerJsdoc(options);

module.exports = specs;