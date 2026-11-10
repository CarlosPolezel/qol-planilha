import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'desma_session';
const SESSION_DURATION_SECONDS = 60 * 60 * 8;

const getAuthConfig = () => {
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;

  if (!username || !password || !secret || secret.length < 32) {
    throw new Error(
      'Configure APP_USERNAME, APP_PASSWORD e SESSION_SECRET (mínimo 32 caracteres) no ambiente do servidor.'
    );
  }
  return { username, password, secret };
};

const digest = (value: string) => createHash('sha256').update(value).digest();

export const validarCredenciais = (username: unknown, password: unknown) => {
  const config = getAuthConfig();
  const userInformado = typeof username === 'string' ? username : '';
  const senhaInformada = typeof password === 'string' ? password : '';
  return (
    timingSafeEqual(digest(userInformado), digest(config.username)) &&
    timingSafeEqual(digest(senhaInformada), digest(config.password))
  );
};

export const criarTokenSessao = (username: string) => {
  const { secret } = getAuthConfig();
  const payload = Buffer.from(
    JSON.stringify({
      sub: username,
      exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
    })
  ).toString('base64url');
  const assinatura = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${assinatura}`;
};

export const validarTokenSessao = (token: string | undefined) => {
  if (!token) return false;
  const { username, secret } = getAuthConfig();
  const [payload, assinatura] = token.split('.');
  if (!payload || !assinatura) return false;

  const assinaturaEsperada = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  const assinaturaInformadaBuffer = Buffer.from(assinatura);
  const assinaturaEsperadaBuffer = Buffer.from(assinaturaEsperada);
  if (
    assinaturaInformadaBuffer.length !== assinaturaEsperadaBuffer.length ||
    !timingSafeEqual(assinaturaInformadaBuffer, assinaturaEsperadaBuffer)
  ) {
    return false;
  }

  try {
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: unknown;
      exp?: unknown;
    };
    return (
      dados.sub === username &&
      typeof dados.exp === 'number' &&
      dados.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
};

export const obterTokenDaRequisicao = (request: Request) => {
  const cookie = request.headers.get('cookie') ?? '';
  const item = cookie
    .split(';')
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith(`${COOKIE_NAME}=`));
  return item ? item.slice(COOKIE_NAME.length + 1) : undefined;
};

export const requisicaoAutenticada = (request: Request) =>
  validarTokenSessao(obterTokenDaRequisicao(request));

export const cookiesSessao = (request: Request, token?: string) => {
  const secure = new URL(request.url).protocol === 'https:';
  const flags = [
    `${COOKIE_NAME}=${token ?? ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${token ? SESSION_DURATION_SECONDS : 0}`,
  ];
  if (secure) flags.push('Secure');
  return flags.join('; ');
};

export const origemValida = (request: Request) => {
  const origem = request.headers.get('origin');
  return Boolean(origem && origem === new URL(request.url).origin);
};

export const respostaJson = (dados: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(dados, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
