import { next } from '@vercel/functions';
import { obterTokenDaRequisicao, validarTokenSessao } from './server/session.js';

export default function proxy(request: Request) {
  const url = new URL(request.url);
  const authenticated = validarTokenSessao(obterTokenDaRequisicao(request));

  if (url.pathname === '/' && !authenticated) {
    return Response.redirect(new URL('/login', request.url), 307);
  }
  if (url.pathname === '/login' && authenticated) {
    return Response.redirect(new URL('/', request.url), 307);
  }
  return next();
}
