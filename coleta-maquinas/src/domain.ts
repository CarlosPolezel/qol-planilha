export interface MaquinaConfig {
  id: number;
  nome: string;
  totalPostos: number;
}

export const CONFIG_MAQUINAS: MaquinaConfig[] = [
  { id: 1, nome: 'Máquina 01', totalPostos: 30 },
  { id: 2, nome: 'Máquina 02', totalPostos: 24 },
  { id: 3, nome: 'Máquina 03', totalPostos: 24 },
  { id: 4, nome: 'Máquina 04', totalPostos: 24 },
];

export const OPCOES_TAMANHO = Array.from({ length: 16 }, (_, index) => 33 + index);
export const LIMITE_ESTOQUE_LITROS = 13;

export interface PostoData {
  numeracaoPosto: number;
  tamanho: number;
  tempoRealCompacta: number;
  tempoRealInjetada: number;
}

export interface ConsumoDesmoldante {
  estoqueInicialL: number;
  reposicaoL: number;
  estoqueFinalL: number;
}

export interface MaquinaData {
  idMaquina: number;
  nomeMaquina: string;
  postos: PostoData[];
  desmoldante: ConsumoDesmoldante;
}

export interface ColetaDiaria {
  idColeta: number;
  horarioSalvamento?: string;
  maquinas: MaquinaData[];
}

export interface DiaColeta {
  data: string;
  coletas: ColetaDiaria[];
}

export interface LinhaInjecaoExcel {
  Data: string;
  Setor: string;
  Coleta: string;
  'Horário Registro': string;
  Máquina: string;
  'Posto Nº': number;
  Tamanho: number;
  'T.R. Compacta': number;
  'T.R. Injetada': number;
}

export interface LinhaDesmoldanteExcel {
  Data: string;
  Coleta: string;
  Máquina: string;
  'Estoque Inicial (L)': number;
  'Reposição (L)': number;
  'Estoque Final (L)': number;
  'Consumo (L)': number;
}

export const gerarEstruturaDia = (data: string): DiaColeta => {
  const coletas = [1, 2, 3, 4].map((idColeta): ColetaDiaria => ({
    idColeta,
    maquinas: CONFIG_MAQUINAS.map((maquina) => ({
      idMaquina: maquina.id,
      nomeMaquina: maquina.nome,
      postos: Array.from({ length: maquina.totalPostos }, (_, index) => ({
        numeracaoPosto: index + 1,
        tamanho: 33,
        tempoRealCompacta: 0,
        tempoRealInjetada: 0,
      })),
      desmoldante: {
        estoqueInicialL: 0,
        reposicaoL: 0,
        estoqueFinalL: 0,
      },
    })),
  }));
  return { data, coletas };
};

const arredondarTresCasas = (valor: number) =>
  Math.round((valor + Number.EPSILON) * 1000) / 1000;

const converterNumero = (valor: unknown, campo: string, maximo?: number) => {
  const numero =
    valor === '' || valor === null || valor === undefined
      ? 0
      : typeof valor === 'number'
        ? valor
        : Number(String(valor).replace(',', '.'));

  if (!Number.isFinite(numero) || numero < 0) {
    throw new Error(`${campo}: informe um número igual ou maior que zero.`);
  }
  if (maximo !== undefined && numero > maximo) {
    throw new Error(`${campo}: o limite permitido é ${maximo} L.`);
  }
  return arredondarTresCasas(numero);
};

export const consumoDesmoldante = (dados: ConsumoDesmoldante) =>
  arredondarTresCasas(
    dados.estoqueInicialL + dados.reposicaoL - dados.estoqueFinalL
  );

export const normalizarDia = (valor: unknown, dataEsperada?: string): DiaColeta => {
  if (!valor || typeof valor !== 'object') {
    throw new Error('Os dados do dia estão em um formato inválido.');
  }
  const registro = valor as Record<string, unknown>;
  const data = String(registro.data ?? dataEsperada ?? '');
  const dateValue = new Date(`${data}T00:00:00`);
  const dateIsValid =
    /^\d{4}-\d{2}-\d{2}$/.test(data) &&
    !Number.isNaN(dateValue.getTime()) &&
    `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, '0')}-${String(
      dateValue.getDate()
    ).padStart(2, '0')}` === data;
  if (!dateIsValid || (dataEsperada && data !== dataEsperada)) {
    throw new Error('A data informada é inválida ou não corresponde ao dia solicitado.');
  }

  if (!Array.isArray(registro.coletas) || registro.coletas.length !== 4) {
    throw new Error('O dia deve conter exatamente quatro coletas.');
  }

  const coletas = registro.coletas.map((coletaValor, coletaIndex): ColetaDiaria => {
    if (!coletaValor || typeof coletaValor !== 'object') {
      throw new Error(`A ${coletaIndex + 1}ª coleta está inválida.`);
    }
    const coleta = coletaValor as Record<string, unknown>;
    if (
      Number(coleta.idColeta) !== coletaIndex + 1 ||
      !Array.isArray(coleta.maquinas) ||
      coleta.maquinas.length !== CONFIG_MAQUINAS.length
    ) {
      throw new Error(`A ${coletaIndex + 1}ª coleta está incompleta.`);
    }

    const maquinasPorId = new Map<number, unknown>();
    for (const maquina of coleta.maquinas) {
      if (maquina && typeof maquina === 'object') {
        const registroMaquina = maquina as Record<string, unknown>;
        maquinasPorId.set(Number(registroMaquina.idMaquina), maquina);
      }
    }
    if (maquinasPorId.size !== CONFIG_MAQUINAS.length) {
      throw new Error(`A ${coletaIndex + 1}ª coleta deve conter as quatro máquinas.`);
    }

    const maquinas = CONFIG_MAQUINAS.map((configuracao): MaquinaData => {
      const maquinaValor = maquinasPorId.get(configuracao.id);
      if (!maquinaValor || typeof maquinaValor !== 'object') {
        throw new Error(`${configuracao.nome} está ausente na ${coletaIndex + 1}ª coleta.`);
      }
      const maquina = maquinaValor as Record<string, unknown>;
      if (!Array.isArray(maquina.postos) || maquina.postos.length !== configuracao.totalPostos) {
        throw new Error(`${configuracao.nome} deve conter ${configuracao.totalPostos} postos.`);
      }

      const postos = maquina.postos.map((postoValor, postoIndex): PostoData => {
        if (!postoValor || typeof postoValor !== 'object') {
          throw new Error(`${configuracao.nome}, posto ${postoIndex + 1}: dados inválidos.`);
        }
        const posto = postoValor as Record<string, unknown>;
        const tamanho = converterNumero(posto.tamanho, 'Tamanho');
        if (
          Number(posto.numeracaoPosto) !== postoIndex + 1 ||
          !OPCOES_TAMANHO.includes(tamanho)
        ) {
          throw new Error(`${configuracao.nome}, posto ${postoIndex + 1}: dados inválidos.`);
        }
        return {
          numeracaoPosto: postoIndex + 1,
          tamanho,
          tempoRealCompacta: converterNumero(
            posto.tempoRealCompacta,
            `${configuracao.nome}, posto ${postoIndex + 1}, tempo compacta`
          ),
          tempoRealInjetada: converterNumero(
            posto.tempoRealInjetada,
            `${configuracao.nome}, posto ${postoIndex + 1}, tempo injetada`
          ),
        };
      });

      const consumoValor =
        maquina.desmoldante && typeof maquina.desmoldante === 'object'
          ? (maquina.desmoldante as Record<string, unknown>)
          : {};
      const desmoldante: ConsumoDesmoldante = {
        estoqueInicialL: converterNumero(
          consumoValor.estoqueInicialL,
          `${configuracao.nome}, estoque inicial`,
          LIMITE_ESTOQUE_LITROS
        ),
        reposicaoL: converterNumero(
          consumoValor.reposicaoL,
          `${configuracao.nome}, reposição`,
          LIMITE_ESTOQUE_LITROS
        ),
        estoqueFinalL: converterNumero(
          consumoValor.estoqueFinalL,
          `${configuracao.nome}, estoque final`,
          LIMITE_ESTOQUE_LITROS
        ),
      };
      if (consumoDesmoldante(desmoldante) < 0) {
        throw new Error(
          `${configuracao.nome}: o estoque final excede o inicial mais a reposição informada.`
        );
      }

      return {
        idMaquina: configuracao.id,
        nomeMaquina: configuracao.nome,
        postos,
        desmoldante,
      };
    });

    const horario = String(coleta.horarioSalvamento ?? '').trim();
    return {
      idColeta: coletaIndex + 1,
      ...(horario ? { horarioSalvamento: horario } : {}),
      maquinas,
    };
  });

  return { data, coletas };
};
