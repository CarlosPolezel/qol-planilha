import { BlobPreconditionFailedError, get, list, put } from '@vercel/blob';
import {
  exportarWorkbook,
  importarWorkbook,
} from '../server/excel.js';
import { normalizarDia, gerarEstruturaDia } from '../src/domain.js';
import { requisicaoAutenticada, respostaJson } from '../server/session.js';

const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const validarData = (value: string | null) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) &&
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}` === value
    ? value
    : '';
};

const caminhoDia = (date: string) => `coletas/${date}.xlsx`;

const encontrarBlob = async (date: string) => {
  const result = await get(caminhoDia(date), { access: 'private', useCache: false });
  return result?.statusCode === 200 ? result : null;
};

const listarDatas = async () => {
  const datas = new Set<string>();
  let cursor: string | undefined;

  do {
    const resultado = await list({ prefix: 'coletas/', limit: 1000, cursor });
    for (const blob of resultado.blobs) {
      const match = blob.pathname.match(/^coletas\/(\d{4}-\d{2}-\d{2})\.xlsx$/);
      if (match && validarData(match[1])) datas.add(match[1]);
    }
    cursor = resultado.hasMore ? resultado.cursor : undefined;
  } while (cursor);

  return [...datas].sort((a, b) => b.localeCompare(a));
};

export default async function handler(request: Request): Promise<Response> {
  let autenticado = false;
  try {
    autenticado = requisicaoAutenticada(request);
  } catch (error) {
    console.error('Configuração de sessão ausente ou inválida:', error);
    return respostaJson({ error: 'O acesso ao sistema não está configurado.' }, 503);
  }
  if (!autenticado) {
    return respostaJson({ error: 'Sessão encerrada. Entre novamente.' }, 401);
  }

  const url = new URL(request.url);
  if (request.method === 'GET' && url.searchParams.get('dates') === '1') {
    try {
      return respostaJson({ dates: await listarDatas() });
    } catch (error) {
      console.error('Falha ao listar os arquivos diários no Vercel Blob:', error);
      return respostaJson({ error: 'Não foi possível carregar o histórico compartilhado.' }, 503);
    }
  }

  const date = validarData(url.searchParams.get('date'));
  if (!date) return respostaJson({ error: 'Informe uma data válida no formato AAAA-MM-DD.' }, 400);
  const pathname = caminhoDia(date);

  try {
    if (request.method === 'GET') {
      const blob = await encontrarBlob(date);
      if (!blob) {
        return respostaJson({ day: gerarEstruturaDia(date), etag: null, exists: false });
      }

      if (url.searchParams.get('download') === '1') {
        const workbook = await new Response(blob.stream).arrayBuffer();
        return new Response(workbook, {
          headers: {
            'Cache-Control': 'private, no-store',
            'Content-Disposition': `attachment; filename="Coleta_Desma_${date}.xlsx"`,
            'Content-Type': MIME_XLSX,
            ETag: blob.blob.etag,
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }

      const workbook = await new Response(blob.stream).arrayBuffer();
      const day = importarWorkbook(new Uint8Array(workbook), date);
      return respostaJson({ day, etag: blob.blob.etag, exists: true });
    }

    if (request.method === 'PUT') {
      const contentLength = Number(request.headers.get('content-length') ?? 0);
      if (contentLength > 1_000_000) {
        return respostaJson({ error: 'O arquivo diário excede o tamanho permitido.' }, 413);
      }
      let rawDay: unknown;
      try {
        rawDay = await request.json();
      } catch {
        return respostaJson({ error: 'O conteúdo enviado não é um JSON válido.' }, 400);
      }
      const day = normalizarDia(rawDay, date);
      const currentBlob = await encontrarBlob(date);
      const requestedEtag = request.headers.get('if-match');

      if (currentBlob && (!requestedEtag || requestedEtag !== currentBlob.blob.etag)) {
        return respostaJson(
          { error: 'Este dia foi atualizado em outro acesso. Recarregue antes de salvar.' },
          409,
          { ETag: currentBlob.blob.etag }
        );
      }
      if (!currentBlob && requestedEtag) {
        return respostaJson({ error: 'O arquivo diário foi removido. Recarregue o histórico.' }, 409);
      }

      const workbook = exportarWorkbook(day);
      const savedBlob = await put(pathname, workbook, {
        access: 'private',
        allowOverwrite: Boolean(currentBlob),
        ...(currentBlob ? { ifMatch: currentBlob.blob.etag } : {}),
        contentType: MIME_XLSX,
      });
      return respostaJson({ day, etag: savedBlob.etag, exists: true });
    }

    return respostaJson({ error: 'Método não permitido.' }, 405, { Allow: 'GET, PUT' });
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) {
      return respostaJson(
        { error: 'Outro acesso atualizou este arquivo. Recarregue os dados antes de salvar.' },
        409
      );
    }
    console.error(`Falha ao processar o arquivo diário ${date}:`, error);
    return respostaJson(
      { error: error instanceof Error ? error.message : 'Falha ao processar o arquivo diário.' },
      500
    );
  }
}
