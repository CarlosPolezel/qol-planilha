import {
  cookiesSessao,
  criarTokenSessao,
  origemValida,
  obterTokenDaRequisicao,
  respostaJson,
  validarCredenciais,
  validarTokenSessao,
} from '../server/session.js';

export default async function handler(request: Request): Promise<Response> {
  try {
    if (request.method === 'GET') {
      const authenticated = validarTokenSessao(obterTokenDaRequisicao(request));
      return respostaJson({ authenticated });
    }

    if (!origemValida(request)) {
      return respostaJson({ error: 'Origem da requisição não autorizada.' }, 403);
    }

    if (request.method === 'POST') {
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return respostaJson({ error: 'Dados de login inválidos.' }, 400);
      }

      if (!payload || typeof payload !== 'object') {
        return respostaJson({ error: 'Informe usuário e senha.' }, 400);
      }

      const credentials = payload as Record<string, unknown>;
      if (!validarCredenciais(credentials.username, credentials.password)) {
        return respostaJson({ error: 'Usuário ou senha incorretos.' }, 401);
      }

      const token = criarTokenSessao(String(credentials.username));
      return respostaJson(
        { authenticated: true },
        200,
        { 'Set-Cookie': cookiesSessao(request, token) }
      );
    }

    if (request.method === 'DELETE') {
      return respostaJson(
        { authenticated: false },
        200,
        { 'Set-Cookie': cookiesSessao(request) }
      );
    }

    return respostaJson({ error: 'Método não permitido.' }, 405, { Allow: 'GET, POST, DELETE' });
  } catch (error) {
    console.error('Falha no endpoint de autenticação:', error);
    return respostaJson(
      { error: 'Serviço de autenticação não está configurado corretamente.' },
      503
    );
  }
}
