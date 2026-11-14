import { setupServer } from 'msw/node';
import { authHandlers } from './handlers';

export const server = setupServer(...authHandlers);
