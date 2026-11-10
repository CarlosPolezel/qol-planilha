import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import './App.css';
import {
  CONFIG_MAQUINAS,
  LIMITE_ESTOQUE_LITROS,
  OPCOES_TAMANHO,
  consumoDesmoldante,
  gerarEstruturaDia,
  normalizarDia,
  type ConsumoDesmoldante,
  type DiaColeta,
  type MaquinaData,
} from './domain';

type Mensagem = {
  tipo: 'sucesso' | 'erro';
  texto: string;
};

type EstadoSalvamento = 'salvo' | 'salvando' | 'falha' | 'conflito';
type Pagina = 'dashboard' | 'coletas';

interface RespostaDia {
  day: DiaColeta;
  etag: string | null;
  exists: boolean;
}

class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const CAMPOS_INJECAO = [
  'Data',
  'Coleta',
  'Horário Registro',
  'Máquina',
  'Posto Nº',
  'Tamanho',
  'T.R. Compacta',
  'T.R. Injetada',
];

const CHAVE_SESSAO = '/api/auth';
const CHAVE_DADOS = '/api/data';

const getTodayString = () => {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(
    hoje.getDate()
  ).padStart(2, '0')}`;
};

const formatarData = (data: string) => {
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}`;
};

const formatarLitros = (valor: number) =>
  `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} L`;

const requestJson = async <T,>(input: RequestInfo | URL, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new ApiError(
      payload.error ?? 'Não foi possível concluir a operação.',
      response.status
    );
  }
  return payload;
};

const importarArquivoExcel = async (arquivo: File): Promise<DiaColeta> => {
  if (arquivo.size > 10 * 1024 * 1024) {
    throw new Error('O arquivo deve ter no máximo 10 MB.');
  }
  const XLSX = await import('@e965/xlsx');
  const workbook = XLSX.read(await arquivo.arrayBuffer(), { cellDates: false });
  const planilhaInjecao =
    workbook.Sheets['Injeção'] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!planilhaInjecao) throw new Error('O arquivo não contém uma planilha de injeção.');

  const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(planilhaInjecao, {
    defval: '',
  });
  if (linhas.length === 0 || !CAMPOS_INJECAO.every((campo) => campo in linhas[0])) {
    throw new Error('Formato inválido. Selecione um arquivo diário exportado pelo sistema.');
  }

  const data = String(linhas[0].Data ?? '');
  const dia = gerarEstruturaDia(data);
  const postosImportados = new Set<string>();

  const numero = (value: unknown, campo: string) => {
    if (value === '' || value === null || value === undefined) return 0;
    const result = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    if (!Number.isFinite(result)) throw new Error(`O campo "${campo}" contém um valor inválido.`);
    return result;
  };

  for (const linha of linhas) {
    if (String(linha.Data) !== data) throw new Error('O arquivo contém mais de uma data.');
    const coletaId = Number(String(linha.Coleta).match(/^([1-4])ª Coleta$/)?.[1]);
    const maquinaConfig = CONFIG_MAQUINAS.find(
      (item) => item.nome === String(linha.Máquina ?? '').trim()
    );
    const postoNumero = numero(linha['Posto Nº'], 'Posto Nº');
    if (
      !coletaId ||
      !maquinaConfig ||
      !Number.isInteger(postoNumero) ||
      postoNumero < 1 ||
      postoNumero > maquinaConfig.totalPostos
    ) {
      throw new Error('O arquivo contém uma coleta, máquina ou posto inválido.');
    }

    const chave = `${coletaId}:${maquinaConfig.id}:${postoNumero}`;
    if (postosImportados.has(chave)) throw new Error('O arquivo contém postos duplicados.');
    postosImportados.add(chave);
    const coleta = dia.coletas[coletaId - 1];
    const maquina = coleta.maquinas[maquinaConfig.id - 1];
    const posto = maquina.postos[postoNumero - 1];
    posto.tamanho = numero(linha.Tamanho, 'Tamanho');
    posto.tempoRealCompacta = numero(linha['T.R. Compacta'], 'T.R. Compacta');
    posto.tempoRealInjetada = numero(linha['T.R. Injetada'], 'T.R. Injetada');

    const horario = String(linha['Horário Registro'] ?? '').trim();
    if (horario && horario !== 'Pendente') {
      if (coleta.horarioSalvamento && coleta.horarioSalvamento !== horario) {
        throw new Error(`A ${coletaId}ª coleta tem horários divergentes no arquivo.`);
      }
      coleta.horarioSalvamento = horario;
    }
  }

  const totalPostos =
    CONFIG_MAQUINAS.reduce((total, maquina) => total + maquina.totalPostos, 0) * 4;
  if (postosImportados.size !== totalPostos) {
    throw new Error('O arquivo está incompleto; precisa conter as quatro coletas e máquinas.');
  }

  const planilhaDesmoldante = workbook.Sheets['Desmoldante'];
  if (planilhaDesmoldante) {
    const linhasConsumo = XLSX.utils.sheet_to_json<Record<string, unknown>>(planilhaDesmoldante, {
      defval: '',
    });
    const maquinasImportadas = new Set<string>();

    for (const linha of linhasConsumo) {
      const coletaId = Number(String(linha.Coleta).match(/^([1-4])ª Coleta$/)?.[1]);
      const maquinaConfig = CONFIG_MAQUINAS.find(
        (item) => item.nome === String(linha.Máquina ?? '').trim()
      );
      if (!coletaId || !maquinaConfig || String(linha.Data) !== data) {
        throw new Error('A planilha de desmoldante contém dados inválidos.');
      }
      const chave = `${coletaId}:${maquinaConfig.id}`;
      if (maquinasImportadas.has(chave)) {
        throw new Error('A planilha de desmoldante contém medições duplicadas.');
      }
      maquinasImportadas.add(chave);
      dia.coletas[coletaId - 1].maquinas[maquinaConfig.id - 1].desmoldante = {
        estoqueInicialL: numero(linha['Estoque Inicial (L)'], 'Estoque Inicial (L)'),
        reposicaoL: numero(linha['Reposição (L)'], 'Reposição (L)'),
        estoqueFinalL: numero(linha['Estoque Final (L)'], 'Estoque Final (L)'),
      };
    }
    if (maquinasImportadas.size !== 16) {
      throw new Error('A planilha de desmoldante deve ter uma linha por coleta e máquina.');
    }
  }

  return normalizarDia(dia, data);
};

const TelaLogin = ({
  onLogin,
  erro,
  carregando,
}: {
  onLogin: (username: string, password: string) => Promise<void>;
  erro: string;
  carregando: boolean;
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);

  const entrar = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEnviando(true);
    try {
      await onLogin(username.trim(), password);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand">
          <span className="brand-mark" aria-hidden="true">D</span>
          <p className="eyebrow">SETOR DESMA</p>
        </div>
        <h1 id="login-title">Acesse a coleta operacional</h1>
        <p className="login-description">
          Entre com o usuário do sistema para visualizar o dashboard e as coletas do setor.
        </p>
        {erro && <div className="feedback feedback-error" role="alert">{erro}</div>}
        <form className="login-form" onSubmit={entrar}>
          <label>
            <span>Usuário</span>
            <input
              autoComplete="username"
              name="username"
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>
            <span>Senha</span>
            <input
              autoComplete="current-password"
              name="password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="button button-primary login-submit" disabled={enviando || carregando}>
            {enviando ? 'Validando acesso…' : 'Entrar'}
          </button>
        </form>
        <p className="login-security-note">
          Acesso validado pelo servidor. A sessão expira após oito horas.
        </p>
      </section>
    </main>
  );
};

const CampoLitros = ({
  id,
  label,
  value,
  disabled,
  onChange,
  erro,
}: {
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: string) => void;
  erro: string;
}) => (
  <label className="liters-field" htmlFor={id}>
    <span>{label}</span>
    <div className="liters-input-wrap">
      <input
        id={id}
        type="number"
        min="0"
        max={LIMITE_ESTOQUE_LITROS}
        step="0.001"
        inputMode="decimal"
        disabled={disabled}
        value={value || ''}
        placeholder="0,000"
        aria-invalid={Boolean(erro)}
        onChange={(event) => onChange(event.target.value)}
      />
      <span aria-hidden="true">L</span>
    </div>
    <small>{erro || `De 0 a ${LIMITE_ESTOQUE_LITROS} L; vazio equivale a zero.`}</small>
  </label>
);

export default function App() {
  const hoje = getTodayString();
  const [autenticado, setAutenticado] = useState(false);
  const [checandoSessao, setChecandoSessao] = useState(true);
  const [erroLogin, setErroLogin] = useState('');
  const [dataSelecionada, setDataSelecionada] = useState(hoje);
  const [dia, setDia] = useState<DiaColeta | null>(null);
  const etagRef = useRef<string | null>(null);
  const [diaExiste, setDiaExiste] = useState(false);
  const [diaCarregado, setDiaCarregado] = useState(false);
  const [datasDisponiveis, setDatasDisponiveis] = useState<string[]>([]);
  const [pagina, setPagina] = useState<Pagina>(
    window.location.pathname === '/coletas' ? 'coletas' : 'dashboard'
  );
  const [moduloAtivo, setModuloAtivo] = useState<'injecao' | 'desmoldante'>('injecao');
  const [coletaAtualIdx, setColetaAtualIdx] = useState(1);
  const [maquinaAtivaId, setMaquinaAtivaId] = useState(CONFIG_MAQUINAS[0].id);
  const [mensagem, setMensagem] = useState<Mensagem | null>(null);
  const [estadoSalvamento, setEstadoSalvamento] = useState<EstadoSalvamento>('salvo');
  const [erroConsumo, setErroConsumo] = useState('');
  const arquivoInputRef = useRef<HTMLInputElement>(null);
  const ultimoSalvamentoRef = useRef('');
  const salvamentoEmAndamentoRef = useRef(false);
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exibirMensagem = useCallback((texto: string, tipo: Mensagem['tipo'] = 'sucesso') => {
    setMensagem({ texto, tipo });
  }, []);

  const carregarDatas = useCallback(async () => {
    const resultado = await requestJson<{ dates: string[] }>(`${CHAVE_DADOS}?dates=1`);
    setDatasDisponiveis(resultado.dates);
  }, []);

  const buscarDia = useCallback(
    (data: string) => requestJson<RespostaDia>(`${CHAVE_DADOS}?date=${data}`),
    []
  );

  const aplicarDia = useCallback((resultado: RespostaDia) => {
    setDia(resultado.day);
    etagRef.current = resultado.etag;
    setDiaExiste(resultado.exists);
    setDiaCarregado(true);
    ultimoSalvamentoRef.current = JSON.stringify(resultado.day);
    setEstadoSalvamento('salvo');
  }, []);

  useEffect(() => {
    let active = true;
    requestJson<{ authenticated: boolean }>(CHAVE_SESSAO)
      .then(async (result) => {
        if (!active) return;
        if (result.authenticated) {
          setAutenticado(true);
          if (window.location.pathname === '/login') {
            window.history.replaceState(null, '', '/dashboard');
          }
          await carregarDatas();
        } else {
          setAutenticado(false);
          if (window.location.pathname !== '/login') {
            window.history.replaceState(null, '', '/login');
          }
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setErroLogin(
            error instanceof Error
              ? error.message
              : 'O serviço de autenticação não está disponível.'
          );
        }
      })
      .finally(() => {
        if (active) setChecandoSessao(false);
      });

    const handlePopState = () => {
      const path = window.location.pathname;
      setPagina(path === '/coletas' ? 'coletas' : 'dashboard');
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      active = false;
      window.removeEventListener('popstate', handlePopState);
    };
  }, [carregarDatas]);

  useEffect(() => {
    if (!autenticado) return;
    let active = true;
    buscarDia(dataSelecionada)
      .then((resultado) => {
        if (active) aplicarDia(resultado);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDia(null);
        setDiaCarregado(false);
        if (error instanceof ApiError && error.status === 401) {
          setAutenticado(false);
          window.history.replaceState(null, '', '/login');
          return;
        }
        exibirMensagem(
          error instanceof Error ? error.message : 'Não foi possível carregar os dados deste dia.',
          'erro'
        );
      });
    return () => {
      active = false;
    };
  }, [aplicarDia, autenticado, buscarDia, dataSelecionada, exibirMensagem]);

  const salvarDia = useCallback(async (diaParaSalvar: DiaColeta, avisar = false) => {
    const data = diaParaSalvar.data;
    const snapshot = JSON.stringify(diaParaSalvar);
    if (snapshot === ultimoSalvamentoRef.current && diaExiste) return true;
    if (salvamentoEmAndamentoRef.current) return false;
    salvamentoEmAndamentoRef.current = true;
    setEstadoSalvamento('salvando');
    try {
      const headers = etagRef.current ? { 'If-Match': etagRef.current } : undefined;
      const resultado = await requestJson<RespostaDia>(`${CHAVE_DADOS}?date=${data}`, {
        method: 'PUT',
        headers,
        body: snapshot,
      });
      etagRef.current = resultado.etag;
      setDiaExiste(true);
      ultimoSalvamentoRef.current = snapshot;
      setEstadoSalvamento('salvo');
      setDatasDisponiveis((prev) => [...new Set([data, ...prev])].sort((a, b) => b.localeCompare(a)));
      if (avisar) exibirMensagem(`Dados de ${formatarData(data)} sincronizados com o arquivo diário.`);
      return true;
    } catch (error) {
      const mensagemErro =
        error instanceof Error ? error.message : 'Não foi possível sincronizar os dados.';
      if (error instanceof ApiError && error.status === 401) {
        setAutenticado(false);
        window.history.replaceState(null, '', '/login');
        return false;
      }
      setEstadoSalvamento(error instanceof ApiError && error.status === 409 ? 'conflito' : 'falha');
      exibirMensagem(mensagemErro, 'erro');
      return false;
    } finally {
      salvamentoEmAndamentoRef.current = false;
    }
  }, [diaExiste, exibirMensagem]);

  useEffect(() => {
    if (!autenticado || !diaCarregado || !dia || dataSelecionada !== dia.data) return;
    const snapshot = JSON.stringify(dia);
    if (snapshot === ultimoSalvamentoRef.current || temporizadorRef.current) return;
    temporizadorRef.current = setTimeout(() => {
      temporizadorRef.current = null;
      void salvarDia(dia);
    }, 650);
    return () => {
      if (temporizadorRef.current) {
        clearTimeout(temporizadorRef.current);
        temporizadorRef.current = null;
      }
    };
  }, [autenticado, dataSelecionada, dia, diaCarregado, salvarDia]);

  const entrar = async (username: string, password: string) => {
    setErroLogin('');
    try {
      const resultado = await requestJson<{ authenticated: boolean }>(CHAVE_SESSAO, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      setAutenticado(resultado.authenticated);
      setPagina('dashboard');
      window.history.replaceState(null, '', '/dashboard');
      await carregarDatas();
    } catch (error) {
      setErroLogin(
        error instanceof Error ? error.message : 'Não foi possível validar o acesso.'
      );
    }
  };

  const sair = async () => {
    try {
      await requestJson<{ authenticated: boolean }>(CHAVE_SESSAO, { method: 'DELETE' });
    } catch (error) {
      exibirMensagem(
        error instanceof Error ? error.message : 'Não foi possível encerrar a sessão.',
        'erro'
      );
      return;
    }
    setAutenticado(false);
    setDia(null);
    etagRef.current = null;
    setDiaCarregado(false);
    setErroLogin('');
    window.history.replaceState(null, '', '/login');
  };

  const selecionarPagina = (novaPagina: Pagina) => {
    setPagina(novaPagina);
    window.history.pushState(
      null,
      '',
      novaPagina === 'dashboard' ? '/dashboard' : '/coletas'
    );
  };

  const selecionarData = async (data: string) => {
    if (data === dataSelecionada || !data) return;
    if (
      dia &&
      diaCarregado &&
      JSON.stringify(dia) !== ultimoSalvamentoRef.current &&
      !(await salvarDia(dia))
    ) {
      return;
    }
    setDia(null);
    setDiaCarregado(false);
    setDiaExiste(false);
    etagRef.current = null;
    setDataSelecionada(data);
    setMensagem(null);
  };

  const atualizarDia = (transformar: (atual: DiaColeta) => DiaColeta) => {
    if (!dia || dataSelecionada !== hoje || estadoSalvamento === 'conflito') return;
    setEstadoSalvamento('salvando');
    setDia((atual) => (atual ? transformar(atual) : atual));
  };

  const atualizarCampoPosto = (
    postoIdx: number,
    campo: 'tempoRealCompacta' | 'tempoRealInjetada' | 'tamanho',
    valor: string
  ) => {
    const numero = campo === 'tamanho' ? Number.parseInt(valor, 10) : Number(valor);
    const valorSeguro = Number.isFinite(numero) ? numero : 0;
    atualizarDia((atual) => ({
      ...atual,
      coletas: atual.coletas.map((coleta) =>
        coleta.idColeta !== coletaAtualIdx
          ? coleta
          : {
              ...coleta,
              maquinas: coleta.maquinas.map((maquina) =>
                maquina.idMaquina !== maquinaAtivaId
                  ? maquina
                  : {
                      ...maquina,
                      postos: maquina.postos.map((posto, index) =>
                        index === postoIdx ? { ...posto, [campo]: valorSeguro } : posto
                      ),
                    }
              ),
            }
      ),
    }));
  };

  const atualizarConsumo = (
    campo: keyof ConsumoDesmoldante,
    valorTexto: string,
    maquina: MaquinaData
  ) => {
    if (!dia || dataSelecionada !== hoje) return;
    const valor = valorTexto.trim() === '' ? 0 : Number(valorTexto.replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0 || valor > LIMITE_ESTOQUE_LITROS) {
      setErroConsumo(`Informe um valor entre 0 e ${LIMITE_ESTOQUE_LITROS} L.`);
      return;
    }

    const arredondado = Math.round((valor + Number.EPSILON) * 1000) / 1000;
    const consumoAtualizado = { ...maquina.desmoldante, [campo]: arredondado };
    if (consumoDesmoldante(consumoAtualizado) < 0) {
      setErroConsumo('O estoque final não pode exceder o estoque inicial mais a reposição.');
      return;
    }

    setErroConsumo('');
    atualizarDia((atual) => ({
      ...atual,
      coletas: atual.coletas.map((coleta) =>
        coleta.idColeta !== coletaAtualIdx
          ? coleta
          : {
              ...coleta,
              maquinas: coleta.maquinas.map((item) =>
                item.idMaquina === maquinaAtivaId
                  ? { ...item, desmoldante: consumoAtualizado }
                  : item
              ),
            }
      ),
    }));
  };

  const copiarColetaAnterior = () => {
    if (!dia || coletaAtualIdx === 1 || dataSelecionada !== hoje) return;
    const coletaAtual = dia.coletas[coletaAtualIdx - 1];
    const preenchida = coletaAtual.maquinas.some(
      (maquina) =>
        maquina.postos.some(
          (posto) =>
            posto.tamanho !== 33 ||
            posto.tempoRealCompacta !== 0 ||
            posto.tempoRealInjetada !== 0
        ) ||
        Object.values(maquina.desmoldante).some((valor) => valor !== 0)
    );
    if (
      (preenchida || coletaAtual.horarioSalvamento) &&
      !window.confirm('Esta coleta já tem dados. Deseja substituí-los pela coleta anterior?')
    ) {
      return;
    }
    atualizarDia((atual) => ({
      ...atual,
      coletas: atual.coletas.map((coleta, index) =>
        index === coletaAtualIdx - 1
          ? {
              ...coleta,
              horarioSalvamento: undefined,
              maquinas: atual.coletas[index - 1].maquinas.map((maquina) => ({
                ...maquina,
                postos: maquina.postos.map((posto) => ({ ...posto })),
                desmoldante: { ...maquina.desmoldante },
              })),
            }
          : coleta
      ),
    }));
    exibirMensagem(`Dados copiados da ${coletaAtualIdx - 1}ª coleta.`);
  };

  const registrarColeta = async () => {
    if (!dia || dataSelecionada !== hoje) return;
    const horario = new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const atualizado: DiaColeta = {
      ...dia,
      coletas: dia.coletas.map((coleta) =>
        coleta.idColeta === coletaAtualIdx
          ? { ...coleta, horarioSalvamento: horario }
          : coleta
      ),
    };
    setDia(atualizado);
    const salvo = await salvarDia(atualizado);
    if (salvo) exibirMensagem(`Coleta ${coletaAtualIdx} registrada às ${horario}.`);
  };

  const importarExcel = async (event: ChangeEvent<HTMLInputElement>) => {
    const arquivo = event.target.files?.[0];
    event.target.value = '';
    if (!arquivo) return;

    try {
      const importado = await importarArquivoExcel(arquivo);
      const atual = await requestJson<RespostaDia>(`${CHAVE_DADOS}?date=${importado.data}`);
      if (
        atual.exists &&
        !window.confirm(
          `Já existe um arquivo compartilhado de ${formatarData(importado.data)}. Deseja substituí-lo?`
        )
      ) {
        return;
      }
      etagRef.current = atual.etag;
      const salvo = await salvarDia(importado, true);
      if (!salvo) return;
      setDataSelecionada(importado.data);
      setDia(importado);
      setDiaExiste(true);
      setDiaCarregado(true);
      ultimoSalvamentoRef.current = JSON.stringify(importado);
      setModuloAtivo('injecao');
      setPagina('coletas');
      window.history.pushState(null, '', '/coletas');
      exibirMensagem(`Arquivo ${arquivo.name} importado para o histórico compartilhado.`);
    } catch (error) {
      exibirMensagem(
        error instanceof Error ? error.message : 'Não foi possível importar o arquivo.',
        'erro'
      );
    }
  };

  const exportarExcel = async () => {
    if (!dia) return;
    if (!diaExiste && !(await salvarDia(dia))) return;
    if (JSON.stringify(dia) !== ultimoSalvamentoRef.current && !(await salvarDia(dia))) return;
    try {
      const response = await fetch(`${CHAVE_DADOS}?date=${dataSelecionada}&download=1`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? 'Não foi possível baixar o arquivo diário.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Coleta_Desma_${dataSelecionada}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      exibirMensagem(`Arquivo diário de ${formatarData(dataSelecionada)} exportado.`);
    } catch (error) {
      exibirMensagem(
        error instanceof Error ? error.message : 'Não foi possível exportar o arquivo.',
        'erro'
      );
    }
  };

  const recarregarDoServidor = async () => {
    if (
      window.confirm('Isso descarta as alterações locais ainda não sincronizadas. Deseja continuar?')
    ) {
      setMensagem(null);
      try {
        aplicarDia(await buscarDia(dataSelecionada));
      } catch (error) {
        exibirMensagem(
          error instanceof Error ? error.message : 'Não foi possível recarregar os dados.',
          'erro'
        );
      }
    }
  };

  const coletaAtual = dia?.coletas[coletaAtualIdx - 1];
  const maquinaAtual =
    coletaAtual?.maquinas.find((maquina) => maquina.idMaquina === maquinaAtivaId) ??
    coletaAtual?.maquinas[0];

  const resumo = useMemo(() => {
    const porMaquina = CONFIG_MAQUINAS.map((configuracao) => {
      const maquinaColetas =
        dia?.coletas.flatMap((coleta) =>
          coleta.maquinas.filter((maquina) => maquina.idMaquina === configuracao.id)
        ) ?? [];
      return {
        ...configuracao,
        consumo: maquinaColetas.reduce(
          (total, maquina) => total + consumoDesmoldante(maquina.desmoldante),
          0
        ),
      };
    });
    return {
      porMaquina,
      totalConsumo: porMaquina.reduce((total, maquina) => total + maquina.consumo, 0),
      coletasRegistradas: dia?.coletas.filter((coleta) => coleta.horarioSalvamento).length ?? 0,
    };
  }, [dia]);

  if (checandoSessao) {
    return (
      <main className="session-loading" role="status">
        <span className="loading-spinner" aria-hidden="true" />
        <p>Verificando acesso ao sistema…</p>
      </main>
    );
  }

  if (!autenticado) {
    return (
      <TelaLogin
        onLogin={entrar}
        erro={erroLogin}
        carregando={checandoSessao}
      />
    );
  }

  const somenteLeitura = dataSelecionada !== hoje;
  const semHistorico = somenteLeitura && !diaExiste;
  const erroSincronizacao = estadoSalvamento === 'conflito';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-mark" aria-hidden="true">D</span>
          <div>
            <p className="eyebrow">SETOR DESMA</p>
            <h1>Coleta operacional</h1>
          </div>
        </div>
        <div className="header-tools">
          <label className="date-field" htmlFor="collection-date">
            <span>Data dos dados</span>
            <select
              id="collection-date"
              value={dataSelecionada}
              onChange={(event) => void selecionarData(event.target.value)}
            >
              {[...new Set([hoje, ...datasDisponiveis])]
                .sort((a, b) => b.localeCompare(a))
                .map((data) => (
                  <option key={data} value={data}>
                    {data === hoje ? `Hoje · ${formatarData(data)}` : formatarData(data)}
                  </option>
                ))}
            </select>
          </label>
          <span className={`sync-status sync-${estadoSalvamento}`} role="status">
            <span aria-hidden="true" />
            {estadoSalvamento === 'salvando'
              ? 'Sincronizando'
              : estadoSalvamento === 'conflito'
                ? 'Conflito de edição'
                : estadoSalvamento === 'falha'
                  ? 'Falha ao sincronizar'
                  : 'Sincronizado'}
          </span>
          <button
            className="button button-header"
            type="button"
            onClick={() => arquivoInputRef.current?.click()}
          >
            Importar Excel
          </button>
          <button className="button button-header" type="button" onClick={() => void sair()}>
            Sair
          </button>
          <input
            ref={arquivoInputRef}
            className="visually-hidden"
            type="file"
            accept=".xlsx,.xls"
            aria-label="Selecionar arquivo diário de Excel para importar"
            onChange={(event) => void importarExcel(event)}
          />
        </div>
      </header>

      <main className="main-content">
        <nav className="main-nav" aria-label="Navegação principal">
          <button
            type="button"
            className={`main-nav-link ${pagina === 'dashboard' ? 'is-active' : ''}`}
            aria-current={pagina === 'dashboard' ? 'page' : undefined}
            onClick={() => selecionarPagina('dashboard')}
          >
            Visão do dia
          </button>
          <button
            type="button"
            className={`main-nav-link ${pagina === 'coletas' ? 'is-active' : ''}`}
            aria-current={pagina === 'coletas' ? 'page' : undefined}
            onClick={() => selecionarPagina('coletas')}
          >
            Coletas
          </button>
        </nav>

        {somenteLeitura && (
          <div className="notice notice-history" role="status">
            <span className="notice-icon" aria-hidden="true">i</span>
            <p>
              <strong>Consulta histórica</strong>
              <span>
                {semHistorico
                  ? `Não há arquivo diário compartilhado para ${formatarData(dataSelecionada)}.`
                  : `Exibindo os dados compartilhados de ${formatarData(dataSelecionada)} em modo somente leitura.`}
              </span>
            </p>
          </div>
        )}

        {erroSincronizacao && (
          <div className="feedback feedback-error conflict-feedback" role="alert">
            <span>O arquivo foi atualizado por outro acesso. Recarregue antes de continuar.</span>
            <button className="button button-secondary" type="button" onClick={() => void recarregarDoServidor()}>
              Recarregar dados compartilhados
            </button>
          </div>
        )}

        {mensagem && (
          <div
            className={`feedback feedback-${mensagem.tipo}`}
            role={mensagem.tipo === 'erro' ? 'alert' : 'status'}
            aria-live={mensagem.tipo === 'erro' ? 'assertive' : 'polite'}
          >
            {mensagem.texto}
          </div>
        )}

        {!diaCarregado || !dia ? (
          <div className="data-loading" role="status">
            <span className="loading-spinner" aria-hidden="true" />
            <p>Carregando arquivo diário compartilhado…</p>
          </div>
        ) : pagina === 'dashboard' ? (
          <section className="dashboard-view">
            <div className="page-heading">
              <div>
                <p className="eyebrow">ACOMPANHAMENTO OPERACIONAL</p>
                <h2>Resumo do dia</h2>
                <p className="page-description">
                  Indicadores das quatro máquinas em {formatarData(dataSelecionada)}.
                </p>
              </div>
              <button
                className="button button-primary"
                type="button"
                onClick={() => selecionarPagina('coletas')}
              >
                Abrir coletas
              </button>
            </div>

            {semHistorico ? (
              <div className="empty-state dashboard-empty">
                <span className="empty-state-icon" aria-hidden="true">↥</span>
                <h2>Não há dados para este dia</h2>
                <p>Importe um arquivo diário para consultar os indicadores do histórico.</p>
                <button className="button button-primary" onClick={() => arquivoInputRef.current?.click()}>
                  Importar arquivo diário
                </button>
              </div>
            ) : (
              <>
                <div className="dashboard-cards">
                  <article className="metric-card">
                    <span className="metric-label">Coletas registradas</span>
                    <strong>{resumo.coletasRegistradas}<small> / 4</small></strong>
                    <span className="metric-footnote">no dia selecionado</span>
                  </article>
                  <article className="metric-card metric-card-highlight">
                    <span className="metric-label">Consumo total de desmoldante</span>
                    <strong>{formatarLitros(resumo.totalConsumo)}</strong>
                    <span className="metric-footnote">soma das medições das quatro máquinas</span>
                  </article>
                  <article className="metric-card">
                    <span className="metric-label">Máquinas acompanhadas</span>
                    <strong>4</strong>
                    <span className="metric-footnote">Máquina 01 a Máquina 04</span>
                  </article>
                </div>

                <section className="dashboard-panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">DESMOLDANTE</p>
                      <h3>Consumo por máquina</h3>
                    </div>
                    <span className="panel-total">Total: {formatarLitros(resumo.totalConsumo)}</span>
                  </div>
                  <div className="machine-summary-list">
                    {resumo.porMaquina.map((maquina) => {
                      const percentual =
                        resumo.totalConsumo > 0
                          ? Math.min((maquina.consumo / resumo.totalConsumo) * 100, 100)
                          : 0;
                      return (
                        <article className="machine-summary" key={maquina.id}>
                          <div className="machine-summary-heading">
                            <strong>{maquina.nome}</strong>
                            <span>{formatarLitros(maquina.consumo)}</span>
                          </div>
                          <div
                            className="consumption-track"
                            role="img"
                            aria-label={`${maquina.nome}: ${formatarLitros(maquina.consumo)}`}
                          >
                            <span style={{ width: `${percentual}%` }} />
                          </div>
                          <p>
                            {maquina.totalPostos} postos
                            <span aria-hidden="true"> · </span>
                            {dia.coletas.filter((coleta) => coleta.horarioSalvamento).length} coletas registradas
                          </p>
                        </article>
                      );
                    })}
                  </div>
                  <p className="formula-note">
                    Consumo = estoque inicial + reposição − estoque final, somado por coleta.
                  </p>
                </section>
              </>
            )}
          </section>
        ) : (
          <section className="collection-view" aria-label="Coletas operacionais">
            <div className="page-heading collection-page-heading">
              <div>
                <p className="eyebrow">REGISTRO OPERACIONAL</p>
                <h2>Coletas</h2>
                <p className="page-description">
                  Selecione a coleta e a máquina para preencher os dados do dia.
                </p>
              </div>
              <button className="button button-export" type="button" onClick={() => void exportarExcel()}>
                Exportar dia para Excel
              </button>
            </div>

            {semHistorico ? (
              <div className="empty-state">
                <span className="empty-state-icon" aria-hidden="true">↥</span>
                <h2>Este dia ainda não está no histórico compartilhado</h2>
                <p>Importe o arquivo Excel daquele dia para consultar as quatro máquinas.</p>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => arquivoInputRef.current?.click()}
                >
                  Importar arquivo diário
                </button>
              </div>
            ) : (
              <>
                <nav className="module-tabs" aria-label="Tipo de coleta">
                  <button
                    className={`module-tab ${moduloAtivo === 'injecao' ? 'is-active' : ''}`}
                    type="button"
                    aria-pressed={moduloAtivo === 'injecao'}
                    onClick={() => setModuloAtivo('injecao')}
                  >
                    Injeção
                  </button>
                  <button
                    className={`module-tab ${moduloAtivo === 'desmoldante' ? 'is-active' : ''}`}
                    type="button"
                    aria-pressed={moduloAtivo === 'desmoldante'}
                    onClick={() => setModuloAtivo('desmoldante')}
                  >
                    Desmoldante
                  </button>
                </nav>

                <section className="selection-section" aria-label="Selecionar coleta">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">ETAPA 1</p>
                      <h2>Selecione a coleta</h2>
                    </div>
                    <span className="section-context">{formatarData(dataSelecionada)}</span>
                  </div>
                  <div className="collection-selector">
                    {dia.coletas.map((coleta) => {
                      const selecionada = coletaAtualIdx === coleta.idColeta;
                      return (
                        <button
                          key={coleta.idColeta}
                          className={`collection-option ${selecionada ? 'is-active' : ''}`}
                          type="button"
                          aria-pressed={selecionada}
                          onClick={() => setColetaAtualIdx(coleta.idColeta)}
                        >
                          <span className="option-main">
                            <span className="option-number">{coleta.idColeta}</span>
                            <span className="option-label">{coleta.idColeta}ª coleta</span>
                          </span>
                          <span className={`collection-status ${coleta.horarioSalvamento ? 'is-done' : ''}`}>
                            <span className="status-dot" aria-hidden="true" />
                            {coleta.horarioSalvamento
                              ? `Registrada às ${coleta.horarioSalvamento}`
                              : 'Não registrada'}
                          </span>
                          {selecionada && <span className="selected-indicator">Selecionada</span>}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="machine-section" aria-label="Selecionar máquina">
                  <div className="section-heading section-heading-compact">
                    <div>
                      <p className="eyebrow">ETAPA 2</p>
                      <h2>Selecione a máquina</h2>
                    </div>
                  </div>
                  <div className="machine-selector">
                    {CONFIG_MAQUINAS.map((maquina) => (
                      <button
                        key={maquina.id}
                        className={`machine-option ${maquinaAtivaId === maquina.id ? 'is-active' : ''}`}
                        type="button"
                        aria-pressed={maquinaAtivaId === maquina.id}
                        onClick={() => setMaquinaAtivaId(maquina.id)}
                      >
                        <span>{maquina.nome}</span>
                        <span className="machine-post-count">{maquina.totalPostos} postos</span>
                      </button>
                    ))}
                  </div>
                </section>

                <div className="action-bar">
                  <div className="action-group">
                    {coletaAtualIdx > 1 && !somenteLeitura && (
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={erroSincronizacao}
                        onClick={copiarColetaAnterior}
                      >
                        Copiar coleta anterior
                      </button>
                    )}
                    {!somenteLeitura && (
                      <button
                        className="button button-primary"
                        type="button"
                        disabled={erroSincronizacao}
                        onClick={() => void registrarColeta()}
                      >
                        Registrar coleta {coletaAtualIdx}
                      </button>
                    )}
                  </div>
                  <span className="save-hint">
                    Dados sincronizados com o arquivo Excel diário compartilhado.
                  </span>
                </div>

                {moduloAtivo === 'injecao' && maquinaAtual && coletaAtual && (
                  <section className="table-card" aria-label="Dados dos postos">
                    <div className="table-heading">
                      <div>
                        <p className="eyebrow">INJEÇÃO · PREENCHIMENTO</p>
                        <h2>{maquinaAtual.nomeMaquina}</h2>
                      </div>
                      <span className="table-meta">
                        {coletaAtual.idColeta}ª coleta <span aria-hidden="true">·</span>{' '}
                        {maquinaAtual.postos.length} postos
                      </span>
                    </div>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th scope="col">Posto</th>
                            <th scope="col">Tamanho</th>
                            <th scope="col">Tempo real compacta</th>
                            <th scope="col">Tempo real injetada</th>
                          </tr>
                        </thead>
                        <tbody>
                          {maquinaAtual.postos.map((posto, index) => (
                            <tr key={posto.numeracaoPosto}>
                              <th scope="row">Posto {posto.numeracaoPosto}</th>
                              <td>
                                <select
                                  aria-label={`Tamanho do posto ${posto.numeracaoPosto}`}
                                  value={posto.tamanho}
                                  disabled={somenteLeitura || erroSincronizacao}
                                  onChange={(event) =>
                                    atualizarCampoPosto(index, 'tamanho', event.target.value)
                                  }
                                >
                                  {OPCOES_TAMANHO.map((tamanho) => (
                                    <option key={tamanho} value={tamanho}>Nº {tamanho}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  aria-label={`Tempo real compacta do posto ${posto.numeracaoPosto}`}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  inputMode="decimal"
                                  disabled={somenteLeitura || erroSincronizacao}
                                  value={posto.tempoRealCompacta || ''}
                                  placeholder="0,00"
                                  onChange={(event) =>
                                    atualizarCampoPosto(index, 'tempoRealCompacta', event.target.value)
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  aria-label={`Tempo real injetada do posto ${posto.numeracaoPosto}`}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  inputMode="decimal"
                                  disabled={somenteLeitura || erroSincronizacao}
                                  value={posto.tempoRealInjetada || ''}
                                  placeholder="0,00"
                                  onChange={(event) =>
                                    atualizarCampoPosto(index, 'tempoRealInjetada', event.target.value)
                                  }
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="table-footer">
                      Os registros das quatro máquinas e coletas ficam no arquivo diário compartilhado.
                    </p>
                  </section>
                )}

                {moduloAtivo === 'desmoldante' && maquinaAtual && coletaAtual && (
                  <section className="consumption-card">
                    <div className="table-heading">
                      <div>
                        <p className="eyebrow">DESMOLDANTE · ESTOQUE POR COLETA</p>
                        <h2>{maquinaAtual.nomeMaquina}</h2>
                      </div>
                      <span className="table-meta">
                        {coletaAtual.idColeta}ª coleta
                      </span>
                    </div>
                    <div className="consumption-fields">
                      <CampoLitros
                        id="estoque-inicial"
                        label="Estoque inicial"
                        value={maquinaAtual.desmoldante.estoqueInicialL}
                        disabled={somenteLeitura || erroSincronizacao}
                        erro={erroConsumo}
                        onChange={(value) =>
                          atualizarConsumo('estoqueInicialL', value, maquinaAtual)
                        }
                      />
                      <CampoLitros
                        id="reposicao"
                        label="Reposição na coleta"
                        value={maquinaAtual.desmoldante.reposicaoL}
                        disabled={somenteLeitura || erroSincronizacao}
                        erro={erroConsumo}
                        onChange={(value) =>
                          atualizarConsumo('reposicaoL', value, maquinaAtual)
                        }
                      />
                      <CampoLitros
                        id="estoque-final"
                        label="Estoque final"
                        value={maquinaAtual.desmoldante.estoqueFinalL}
                        disabled={somenteLeitura || erroSincronizacao}
                        erro={erroConsumo}
                        onChange={(value) =>
                          atualizarConsumo('estoqueFinalL', value, maquinaAtual)
                        }
                      />
                      <div className="consumption-result">
                        <span>Consumo calculado</span>
                        <strong>
                          {formatarLitros(consumoDesmoldante(maquinaAtual.desmoldante))}
                        </strong>
                        <small>Estoque inicial + reposição − estoque final</small>
                      </div>
                    </div>
                    <p className="table-footer">
                      Cada valor aceita de 0 a 13 L. Valores com mais de três casas decimais são arredondados.
                      Campos vazios equivalem a zero.
                    </p>
                  </section>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
