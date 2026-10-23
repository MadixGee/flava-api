const errorSchema = (example: string) => ({
  type: 'object',
  properties: { error: { type: 'string', examples: [example] } },
});

const messageSchema = (example: string) => ({
  type: 'object',
  properties: { message: { type: 'string', examples: [example] } },
});

export const flavaLogoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#111"/><text x="32" y="44" font-family="Arial,sans-serif" font-size="36" font-weight="700" text-anchor="middle" fill="#fff">F</text></svg>';

export const openApiDocument = {
  openapi: '3.0.3',
  info: { title: 'Flava API', version: '0.1.0' },
  tags: [{ name: 'Auth', description: 'Authentication endpoints' }],
  paths: {
    '/auth/email/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Sign up with email and password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', maxLength: 320, example: 'listener@example.com' },
                  password: { type: 'string', minLength: 8, maxLength: 128, example: 'correct-horse-battery' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'User created', content: { 'application/json': { schema: messageSchema('User created successfully') } } },
          400: { description: 'Invalid input', content: { 'application/json': { schema: errorSchema('Please check email or password invalid') } } },
          409: { description: 'Email already registered', content: { 'application/json': { schema: errorSchema('Email already registered') } } },
        },
      },
    },
  },
};
